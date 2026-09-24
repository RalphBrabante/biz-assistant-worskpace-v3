const crypto = require('crypto');
const {Op, literal} = require('sequelize');
const {getModels} = require('../sequelize');
const gmail = require('../services/gmail-tickets');
const hostinger = require('../services/hostinger-tickets');
const STATUSES = ['open', 'pending', 'resolved', 'closed'];
const INCLUDE = [{association: 'customer', attributes: ['id', 'name']}, {association: 'assignee', attributes: ['id', 'firstName', 'lastName']}];
const fail = (status, message) => Object.assign(new Error(message), {status});
function scope(req) {
  const organizationId = (req.auth?.roleCodes || []).includes('superuser') ? req.query.organizationId : req.auth?.user?.organizationId;
  if (!organizationId || typeof organizationId !== 'string') throw fail(400, 'Select an organization to manage tickets.');
  return {organizationId};
}
function permit(permission) {
  return (req, res, next) => {
    const permissions = req.auth?.permissions || new Set();
    if (req.auth && (req.auth.isPrivileged || permissions.has(permission) || permissions.has('tickets.*') || permissions.has('*'))) return next();
    return res.status(req.auth ? 403 : 401).json({message: 'You do not have permission to perform this ticket action.'});
  };
}
function admin(req, res, next) {
  if ((req.auth?.roleCodes || []).some(role => ['administrator', 'superuser'].includes(role))) return next();
  return res.status(403).json({message: 'Only organization administrators can manage mailbox connections.'});
}
function endpoint(fn) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return await fn(req, res); }
    catch (error) {
      if (!error.status) console.error('[tickets] Request failed:', error.name);
      return res.status(error.status || 500).json({message: error.status ? error.message : 'Unable to complete this ticket action. Please try again.'});
    }
  };
}
function text(value, name, max, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw fail(400, `Enter a valid ${name} (up to ${max} characters).`);
  return value.trim();
}
async function member(models, organizationId, userId, transaction) {
  const user = await models.User.findOne({where: {id: userId, isActive: true}, transaction});
  if (!user) return false;
  return user.organizationId === organizationId || Boolean(await models.OrganizationUser.findOne({where: {organizationId, userId, isActive: true}, transaction}));
}
async function fields(models, organizationId, body, transaction) {
  const values = {};
  if (body.status !== undefined) { if (!STATUSES.includes(body.status)) throw fail(400, 'Choose a valid status.'); values.status = body.status; }
  if (body.priority !== undefined) { if (![1, 2, 3, 4].includes(body.priority)) throw fail(400, 'Choose a valid priority.'); values.priority = body.priority; }
  if (body.dueAt !== undefined) { if (body.dueAt !== null && (typeof body.dueAt !== 'string' || !Number.isFinite(Date.parse(body.dueAt)))) throw fail(400, 'Choose a valid due date.'); values.dueAt = body.dueAt ? new Date(body.dueAt) : null; }
  if (body.customerId !== undefined) {
    if (body.customerId !== null && (typeof body.customerId !== 'string' || !await models.Customer.findOne({where: {id: body.customerId, organizationId, isActive: true}, transaction}))) throw fail(400, 'Choose an active customer from this organization.');
    values.customerId = body.customerId;
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId !== null && (typeof body.assigneeId !== 'string' || !await member(models, organizationId, body.assigneeId, transaction))) throw fail(400, 'Choose an active teammate from this organization.');
    values.assigneeId = body.assigneeId;
  }
  return values;
}
async function ticketFor(models, req, transaction) {
  const ticket = await models.EmailTicket.findOne({where: {...scope(req), id: req.params.id}, transaction, ...(transaction ? {lock: transaction.LOCK.UPDATE} : {})});
  if (!ticket) throw fail(404, 'Ticket not found.');
  return ticket;
}
const list = endpoint(async (req, res) => {
  const models = getModels(), where = scope(req), q = req.query;
  if (q.status) { if (!STATUSES.includes(q.status)) throw fail(400, 'Invalid status.'); where.status = q.status; }
  if (q.priority) { if (![1, 2, 3, 4].includes(Number(q.priority))) throw fail(400, 'Invalid priority.'); where.priority = Number(q.priority); }
  if (q.customerId) where.customerId = text(q.customerId, 'customer', 36);
  if (q.assigneeId) where.assigneeId = q.assigneeId === 'unassigned' ? null : q.assigneeId === 'me' ? req.auth.userId : text(q.assigneeId, 'assignee', 36);
  if (q.overdue === 'true') { where.dueAt = {[Op.lt]: new Date()}; where.status = {[Op.in]: ['open', 'pending']}; }
  if (q.q) { const search = text(q.q, 'search', 200); where[Op.or] = [{subject: {[Op.like]: `%${search}%`}}, {requesterEmail: {[Op.like]: `%${search}%`}}]; }
  const page = Number(q.page || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw fail(400, 'Invalid page.');
  const orders = {updated: [['lastMessageAt', 'DESC']], oldest: [['createdAt', 'ASC']], priority: [['priority', 'DESC'], ['lastMessageAt', 'DESC']], due: [[literal('`EmailTicket`.`due_at` IS NULL'), 'ASC'], ['dueAt', 'ASC']]};
  if (q.sort && !Object.hasOwn(orders, q.sort)) throw fail(400, 'Invalid sort.');
  const {rows, count} = await models.EmailTicket.findAndCountAll({where, include: INCLUDE, order: [...orders[q.sort || 'updated'], ['id', 'ASC']], limit: 25, offset: (page - 1) * 25});
  return res.json({data: rows, meta: {page, total: count, totalPages: Math.ceil(count / 25)}});
});
const options = endpoint(async (req, res) => {
  const models = getModels(), {organizationId} = scope(req);
  const memberships = await models.OrganizationUser.findAll({where: {organizationId, isActive: true}, attributes: ['userId']});
  const users = await models.User.findAll({where: {isActive: true, [Op.or]: [{organizationId}, {id: {[Op.in]: memberships.map(row => row.userId)}}]}, attributes: ['id', 'firstName', 'lastName'], order: [['firstName', 'ASC']]});
  const customers = await models.Customer.findAll({where: {organizationId, isActive: true}, attributes: ['id', 'name'], order: [['name', 'ASC']]});
  const mailbox = await models.GmailMailbox.findOne({where: {organizationId}});
  const provider = mailbox?.provider || 'gmail';
  const automaticSync = process.env.EMAIL_TICKET_SYNC_ENABLED !== 'false' && (provider === 'gmail' ? gmail.configured() && process.env.GMAIL_SYNC_ENABLED !== 'false' : hostinger.configured());
  return res.json({data: {users, customers, gmailConfigured: gmail.configured(), hostingerConfigured: hostinger.configured(), automaticSync, mailbox: mailbox ? {provider, email: mailbox.email, connected: Boolean(provider === 'gmail' ? mailbox.encryptedRefreshToken : mailbox.encryptedPassword), lastSyncedAt: mailbox.lastSyncedAt, importing: Boolean(mailbox.pageToken), lastError: mailbox.lastError} : null}});
});
const detail = endpoint(async (req, res) => {
  const models = getModels(), ticket = await ticketFor(models, req);
  // Page the conversation independently so very long email threads remain usable.
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && !Number.isFinite(before.getTime())) throw fail(400, 'Invalid conversation cursor.');
  const where = {ticketId: ticket.id, organizationId: ticket.organizationId};
  if (before) {
    const beforeId = text(req.query.beforeId, 'conversation cursor', 36);
    where[Op.or] = [{createdAt: {[Op.lt]: before}}, {createdAt: before, id: {[Op.lt]: beforeId}}];
  }
  const messages = await models.TicketMessage.findAll({where, include: [{association: 'author', attributes: ['firstName', 'lastName']}], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 100});
  return res.json({data: {ticket, messages: messages.reverse(), hasMore: messages.length === 100}});
});
const create = endpoint(async (req, res) => {
  const models = getModels(), {organizationId} = scope(req), body = req.body || {};
  const subject = text(body.subject, 'subject', 500), description = text(body.body, 'description', 50000);
  const requesterEmail = gmail.emailAddress(body.requesterEmail);
  if (!requesterEmail) throw fail(400, 'Enter a valid requester email.');
  const ticket = await models.EmailTicket.sequelize.transaction(async transaction => {
    if (!await models.Organization.findByPk(organizationId, {transaction})) throw fail(404, 'Organization not found.');
    const values = await fields(models, organizationId, body, transaction);
    const ticket = await models.EmailTicket.create({organizationId, subject, requesterEmail, lastMessageAt: new Date(), ...values}, {transaction});
    await models.TicketMessage.create({organizationId, ticketId: ticket.id, kind: 'note', body: description, createdBy: req.auth.userId}, {transaction});
    return ticket;
  });
  return res.status(201).json({data: ticket});
});
const update = endpoint(async (req, res) => {
  const models = getModels();
  await models.EmailTicket.sequelize.transaction(async transaction => {
    const ticket = await ticketFor(models, req, transaction);
    if (req.body.version !== ticket.version) throw fail(409, 'This ticket changed. Reopen it before saving.');
    const values = await fields(models, ticket.organizationId, req.body, transaction);
    const changed = Object.keys(values).filter(key => String(values[key] ?? '') !== String(ticket[key] ?? ''));
    if (!changed.length) return;
    const labels = [];
    for (const key of changed) {
      let label = values[key] ?? 'none';
      if (key === 'customerId' && values[key]) label = (await models.Customer.findByPk(values[key], {transaction})).name;
      if (key === 'assigneeId' && values[key]) { const user = await models.User.findByPk(values[key], {transaction}); label = `${user.firstName} ${user.lastName}`; }
      if (key === 'priority') label = ['Low', 'Normal', 'High', 'Urgent'][values[key] - 1];
      labels.push(`${({customerId: 'Customer', assigneeId: 'Assignee', dueAt: 'Due date', status: 'Status', priority: 'Priority'})[key]}: ${label}`);
    }
    await ticket.update({...values, version: ticket.version + 1}, {transaction});
    await models.TicketMessage.create({organizationId: ticket.organizationId, ticketId: ticket.id, kind: 'activity', body: labels.join('\n'), createdBy: req.auth.userId}, {transaction});
  });
  return res.json({message: 'Ticket updated.'});
});
const note = endpoint(async (req, res) => {
  const models = getModels(), body = text(req.body.body, 'note', 50000);
  await models.EmailTicket.sequelize.transaction(async transaction => {
    const ticket = await ticketFor(models, req, transaction);
    await models.TicketMessage.create({organizationId: ticket.organizationId, ticketId: ticket.id, kind: 'note', body, createdBy: req.auth.userId}, {transaction});
    await ticket.update({version: ticket.version + 1}, {transaction});
  });
  return res.status(201).json({message: 'Private note added.'});
});
const reply = endpoint(async (req, res) => {
  const models = getModels(), body = text(req.body.body, 'reply', 50000);
  if (!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(req.body.requestKey || '')) throw fail(400, 'A valid reply request key is required.');
  let ticket, message, alreadyExists = false;
  // Commit the send intent before the external operation. Repeating its key never sends twice.
  await models.EmailTicket.sequelize.transaction(async transaction => {
    ticket = await ticketFor(models, req, transaction);
    message = await models.TicketMessage.findOne({where: {ticketId: ticket.id, requestKey: req.body.requestKey}, transaction});
    if (message) { alreadyExists = true; return; }
    if (!ticket.mailboxId) throw fail(400, 'Email replies are available for imported email tickets.');
    if (req.body.version !== ticket.version) throw fail(409, 'This ticket changed. Reopen it before sending.');
    const internetMessageId = `<${crypto.randomUUID()}@bizassistant.invalid>`;
    message = await models.TicketMessage.create({organizationId: ticket.organizationId, mailboxId: ticket.mailboxId, ticketId: ticket.id, kind: 'outbound', body, createdBy: req.auth.userId, requestKey: req.body.requestKey, internetMessageId, externalMessageKey: hostinger.messageKey(internetMessageId), deliveryStatus: 'sending'}, {transaction});
    await ticket.update({version: ticket.version + 1}, {transaction});
  });
  if (!alreadyExists) {
    let sendAttempted = false;
    try {
      await models.GmailMailbox.sequelize.transaction(async transaction => {
        const mailbox = await models.GmailMailbox.findOne({where: {id: ticket.mailboxId, organizationId: ticket.organizationId}, transaction, lock: transaction.LOCK.UPDATE});
        if (!mailbox || !(mailbox.provider && mailbox.provider !== 'gmail' ? mailbox.encryptedPassword : mailbox.encryptedRefreshToken)) throw fail(400, 'Reconnect the mailbox before sending.');
        const parent = await models.TicketMessage.findOne({where: {ticketId: ticket.id, kind: 'inbound'}, order: [['sentAt', 'DESC']], transaction});
        let identity;
        if (mailbox.provider && mailbox.provider !== 'gmail') {
          const sent = await hostinger.sendReply(mailbox, ticket, message, body, parent?.internetMessageId, () => {sendAttempted = true;});
          identity = {externalMessageKey: sent.externalMessageKey};
          if (sent.warning) await mailbox.update({lastError: sent.warning}, {transaction});
        } else {
          const token = await gmail.accessToken(mailbox);
          const raw = await gmail.replyMime({mailbox, ticket, body, internetMessageId: message.internetMessageId, parentId: parent?.internetMessageId});
          sendAttempted = true;
          const sent = await gmail.gmail(token, 'messages/send', {method: 'POST', body: JSON.stringify({threadId: ticket.gmailThreadId, raw: Buffer.from(raw).toString('base64url')})});
          identity = {gmailMessageId: sent.id};
        }
        await message.update({...identity, sender: mailbox.email, deliveryStatus: 'sent', sentAt: new Date()}, {transaction});
        // Preserve concurrent status/assignment changes while updating the conversation timestamp.
        await models.EmailTicket.update({lastMessageAt: new Date()}, {where: {id: ticket.id, organizationId: ticket.organizationId}, transaction});
      });
    } catch (error) {
      await message.update({deliveryStatus: !sendAttempted || (error.httpStatus && error.httpStatus < 500) || (error.responseCode >= 400 && error.responseCode < 600) ? 'failed' : 'unknown'});
    }
  }
  return res.json({data: {deliveryStatus: message.deliveryStatus}, message: message.deliveryStatus === 'sent' ? 'Reply sent.' : 'Delivery is unconfirmed or failed. Check the mailbox Sent folder before sending another reply.'});
});
const connect = endpoint(async (req, res) => {
  if (!gmail.configured()) throw fail(400, 'Ask your server administrator to configure Gmail OAuth and the token encryption key.');
  const models = getModels(), {organizationId} = scope(req);
  if (!await models.Organization.findByPk(organizationId)) throw fail(404, 'Organization not found.');
  const state = crypto.randomBytes(32).toString('hex');
  await models.GmailOAuthState.create({id: crypto.createHash('sha256').update(state).digest('hex'), organizationId, userId: req.auth.userId, expiresAt: new Date(Date.now() + 10 * 60000)});
  const params = new URLSearchParams({client_id: process.env.GMAIL_CLIENT_ID, redirect_uri: gmail.redirectUri(), response_type: 'code', scope: gmail.SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state});
  return res.json({data: {url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`}});
});
const callback = endpoint(async (req, res) => {
  const models = getModels();
  if (typeof req.query.state !== 'string' || !/^[a-f\d]{64}$/.test(req.query.state)) throw fail(400, 'Invalid Gmail connection request.');
  const id = crypto.createHash('sha256').update(req.query.state).digest('hex');
  const state = await models.GmailOAuthState.findByPk(id);
  if (!state || new Date(state.expiresAt) < new Date()) throw fail(400, 'Gmail connection expired. Start again from Tickets.');
  if (!await models.GmailOAuthState.destroy({where: {id}})) throw fail(400, 'Gmail connection request was already used.');
  if (req.query.error || typeof req.query.code !== 'string') throw fail(400, 'Gmail consent was cancelled. Return to Tickets to reconnect.');
  const user = await models.User.findOne({where: {id: state.userId, isActive: true}, include: [{association: 'roles'}]});
  const roles = (user?.roles || []).map(role => role.code);
  if (!user || (!roles.includes('superuser') && (!roles.includes('administrator') || !await member(models, state.organizationId, user.id)))) throw fail(403, 'Administrator access is no longer available.');
  const token = await gmail.tokenRequest({grant_type: 'authorization_code', code: req.query.code, redirect_uri: gmail.redirectUri()});
  if (!token.refresh_token || !gmail.SCOPES.every(scope => (token.scope || '').split(' ').includes(scope))) throw fail(400, 'Grant both Gmail read and send permissions, then reconnect.');
  const profile = await gmail.gmail(token.access_token, 'profile');
  const email = gmail.emailAddress(profile.emailAddress);
  if (!email) throw fail(400, 'Google did not return a valid mailbox address.');
  await models.GmailMailbox.sequelize.transaction(async transaction => {
    // Lock the organization even for a first connection, when no mailbox row exists yet.
    await models.Organization.findByPk(state.organizationId, {transaction, lock: transaction.LOCK.UPDATE});
    const mailbox = await models.GmailMailbox.findOne({where: {organizationId: state.organizationId}, transaction, lock: transaction.LOCK.UPDATE});
    if (mailbox && (mailbox.email !== email || mailbox.provider !== 'gmail')) throw fail(409, 'Reconnect the same mailbox. This organization already has ticket history linked to another address.');
    if (await models.GmailMailbox.findOne({where: {email, organizationId: {[Op.ne]: state.organizationId}}, transaction})) throw fail(409, 'This mailbox is already connected to another organization.');
    const values = {organizationId: state.organizationId, email, encryptedRefreshToken: gmail.encrypt(token.refresh_token), lastError: null};
    if (mailbox) await mailbox.update(values, {transaction}); else await models.GmailMailbox.create(values, {transaction});
  });
  return res.redirect(`${process.env.APP_BASE_URL.replace(/\/$/, '')}/tickets?gmail=connected`);
});
const disconnect = endpoint(async (req, res) => {
  const models = getModels();
  await models.GmailMailbox.sequelize.transaction(async transaction => {
    const mailbox = await models.GmailMailbox.findOne({where: scope(req), transaction, lock: transaction.LOCK.UPDATE});
    if (mailbox) await mailbox.update({encryptedRefreshToken: null, encryptedPassword: null, lastError: null}, {transaction});
  });
  return res.json({message: 'Mailbox disconnected. Ticket history is retained. For Gmail, you can also revoke this app in your Google account permissions.'});
});
const sync = endpoint(async (req, res) => {
  const mailbox = await getModels().GmailMailbox.findOne({where: scope(req)});
  if (!mailbox || !(mailbox.encryptedRefreshToken || mailbox.encryptedPassword)) throw fail(400, 'Connect a mailbox first.');
  gmail.queueSync(mailbox.id);
  return res.status(202).json({message: 'Sync queued. Refresh shortly to see imported tickets.'});
});
const connectHostinger = endpoint(async (req, res) => {
  if (!hostinger.configured()) throw fail(400, 'Ask your server administrator to configure EMAIL_TICKET_ENCRYPTION_KEY once to enable secure mailbox connections.');
  const models = getModels(), {organizationId} = scope(req);
  const provider = req.body.provider || 'hostinger';
  if (!Object.hasOwn(hostinger.PROVIDERS, provider)) throw fail(400, 'Choose Hostinger Email or Titan Email.');
  const email = gmail.emailAddress(req.body.email);
  if (!email) throw fail(400, 'Enter the complete mailbox email address.');
  const password = req.body.password;
  if (typeof password !== 'string' || !password || password.length > 4096) throw fail(400, 'Enter the mailbox password.');
  await models.GmailMailbox.sequelize.transaction(async transaction => {
    const organization = await models.Organization.findByPk(organizationId, {transaction, lock: transaction.LOCK.UPDATE});
    if (!organization) throw fail(404, 'Organization not found.');
    const mailbox = await models.GmailMailbox.findOne({where: {organizationId}, transaction, lock: transaction.LOCK.UPDATE});
    if (mailbox && (mailbox.email !== email || mailbox.provider !== provider)) throw fail(409, 'This organization already has a mailbox. Reconnect that same address and provider to preserve its ticket history.');
    if (await models.GmailMailbox.findOne({where: {email, organizationId: {[Op.ne]: organizationId}}, transaction})) throw fail(409, 'This mailbox is already linked to another organization.');
    try { await hostinger.verifyCredentials(provider, email, password); }
    catch { throw fail(400, 'Could not sign in to IMAP and SMTP. Check the email, mailbox password, selected provider, and third-party mail access in hPanel.'); }
    const values = {organizationId, provider, email, encryptedPassword: hostinger.encrypt(password), encryptedRefreshToken: null, lastError: null};
    if (mailbox) await mailbox.update(values, {transaction}); else await models.GmailMailbox.create(values, {transaction});
  });
  return res.json({message: 'Mailbox connected to this organization. Use Sync now to import email, or wait for automatic sync.'});
});
module.exports = {connectHostinger, permit, admin, scope, fields, member, list, options, detail, create, update, note, reply, connect, callback, disconnect, sync};
