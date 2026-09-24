const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
function encryptionKey() {
  const value = process.env.GMAIL_TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('Set GMAIL_TOKEN_ENCRYPTION_KEY to a 32-byte hex key.');
  return Buffer.from(value, 'hex');
}
function configured() { try { encryptionKey(); return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.APP_BASE_URL); } catch { return false; } }
function encrypt(value) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}
function decrypt(value) {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
function redirectUri() { return process.env.GMAIL_REDIRECT_URI || `${process.env.APP_BASE_URL.replace(/\/$/, '')}/api/v1/tickets/gmail/callback`; }
async function request(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(15000)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(response.status === 401 || data.error === 'invalid_grant' ? 'Gmail authorization expired. Reconnect the mailbox.' : `Gmail request failed (${response.status}). Try again or check Google API settings.`); error.httpStatus = response.status; throw error; }
  return data;
}
async function tokenRequest(params) {
  return request('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, ...params}).toString()});
}
async function accessToken(mailbox) {
  if (!mailbox?.encryptedRefreshToken) throw new Error('Connect the Gmail mailbox first.');
  const token = await tokenRequest({grant_type: 'refresh_token', refresh_token: decrypt(mailbox.encryptedRefreshToken)});
  return token.access_token;
}
function gmail(token, path, options = {}) { return request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {...options, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}}); }
function header(message, name) { return (message.payload?.headers || []).find(row => row.name.toLowerCase() === name.toLowerCase())?.value || ''; }
function emailAddress(value) {
  const match = String(value || '').match(/<([^<>]+)>/);
  const address = (match ? match[1] : String(value || '')).trim().toLowerCase();
  return /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(address) && address.length <= 255 ? address : '';
}
function plainBody(payload, snippet = '') {
  const texts = [], attachments = [];
  function walk(part) {
    if (!part) return;
    if (part.filename) { attachments.push(part.filename); return; }
    if (part.mimeType === 'text/plain' && part.body?.data) texts.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  // Never render sender-provided HTML or remote images. HTML-only mail uses Gmail's text snippet.
  return `${texts.join('\n') || snippet || '[No plain-text content. Open in Gmail to view.]'}${attachments.length ? `\n\nAttachments (open in Gmail): ${attachments.join(', ')}` : ''}`.slice(0, 200000);
}
async function importThread(models, mailbox, thread, transaction) {
  const messages = (thread.messages || []).filter(m => !(m.labelIds || []).some(label => ['DRAFT', 'SPAM', 'TRASH'].includes(label))).sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  const inbound = messages.find(m => !(m.labelIds || []).includes('SENT') && emailAddress(header(m, 'From')) !== mailbox.email);
  let ticket = await models.EmailTicket.findOne({where: {mailboxId: mailbox.id, gmailThreadId: thread.id}, transaction, lock: transaction.LOCK.UPDATE});
  if (!ticket && !inbound) return;
  let isNew = false;
  if (!ticket) {
    const requesterEmail = emailAddress(header(inbound, 'Reply-To')) || emailAddress(header(inbound, 'From'));
    if (!requesterEmail) return;
    const customers = await models.Customer.findAll({where: {organizationId: mailbox.organizationId, email: requesterEmail, isActive: true}, attributes: ['id'], limit: 2, transaction});
    ticket = await models.EmailTicket.create({organizationId: mailbox.organizationId, mailboxId: mailbox.id, gmailThreadId: thread.id, subject: header(inbound, 'Subject').slice(0, 500) || '(No subject)', requesterEmail, customerId: customers.length === 1 ? customers[0].id : null, lastMessageAt: new Date(Number(inbound.internalDate))}, {transaction});
    isNew = true;
  }
  let changed = false, newInbound = false, latest = new Date(ticket.lastMessageAt || 0);
  for (const message of messages) {
    if (await models.TicketMessage.findOne({where: {ticketId: ticket.id, gmailMessageId: message.id}, transaction})) continue;
    const internetMessageId = header(message, 'Message-ID').slice(0, 998);
    const pending = internetMessageId && await models.TicketMessage.findOne({where: {ticketId: ticket.id, internetMessageId, kind: 'outbound'}, transaction});
    if (pending) { await pending.update({gmailMessageId: message.id, deliveryStatus: 'sent', sender: mailbox.email, sentAt: new Date(Number(message.internalDate))}, {transaction}); continue; }
    const sender = emailAddress(header(message, 'From'));
    const outbound = (message.labelIds || []).includes('SENT') || sender === mailbox.email;
    const sentAt = new Date(Number(message.internalDate));
    await models.TicketMessage.create({organizationId: mailbox.organizationId, ticketId: ticket.id, kind: outbound ? 'outbound' : 'inbound', body: plainBody(message.payload, message.snippet), sender, gmailMessageId: message.id, internetMessageId, deliveryStatus: 'sent', sentAt, createdAt: sentAt}, {transaction});
    changed = true;
    if (!outbound && sentAt > new Date(ticket.lastMessageAt || 0)) newInbound = true;
    if (sentAt > latest) latest = sentAt;
  }
  if (changed) await ticket.update({lastMessageAt: latest, version: ticket.version + 1, ...(!isNew && newInbound && ['resolved', 'closed', 'pending'].includes(ticket.status) ? {status: 'open'} : {})}, {transaction});
}
// A row lock serializes sync/replies/disconnect across API instances. Each sync handles
// one bounded page; the durable page token resumes larger imports on the next tick.
async function syncMailbox(id) {
  const models = getModels();
  try {
    await models.GmailMailbox.sequelize.transaction(async transaction => {
      const mailbox = await models.GmailMailbox.findByPk(id, {transaction, lock: transaction.LOCK.UPDATE});
      if (!mailbox?.encryptedRefreshToken) return;
      const token = await accessToken(mailbox);
      const started = mailbox.syncStartedAt || new Date();
      const after = Math.floor((mailbox.lastSyncedAt ? new Date(mailbox.lastSyncedAt).getTime() - 300000 : new Date(started).getTime() - 30 * 86400000) / 1000);
      const params = new URLSearchParams({maxResults: '20', q: `after:${after} -in:spam -in:trash -in:drafts`});
      if (mailbox.pageToken) params.set('pageToken', mailbox.pageToken);
      const page = await gmail(token, `threads?${params}`);
      for (const thread of page.threads || []) {
        const full = await gmail(token, `threads/${encodeURIComponent(thread.id)}?format=full`);
        await importThread(models, mailbox, full, transaction);
      }
      await mailbox.update({pageToken: page.nextPageToken || null, syncStartedAt: page.nextPageToken ? started : null, lastSyncedAt: page.nextPageToken ? mailbox.lastSyncedAt : started, lastError: null}, {transaction});
    });
  } catch (error) {
    // Only safe, controlled error messages are persisted. Never store provider payloads/tokens.
    const lastError = error.httpStatus ? error.message : 'Gmail sync failed. Check server configuration and retry.';
    await models.GmailMailbox.update({lastError, ...(error.httpStatus === 400 ? {pageToken: null, syncStartedAt: null} : {})}, {where: {id}});
  }
}
async function replyMime({mailbox, ticket, body, internetMessageId, parentId}) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const clean = value => String(value || '').replace(/[\r\n]/g, '');
  // MailComposer folds long Unicode headers and MIME body lines correctly.
  return new MailComposer({from: clean(mailbox.email), to: clean(ticket.requesterEmail),
    subject: clean(ticket.subject), text: body, messageId: clean(internetMessageId),
    ...(parentId ? {inReplyTo: clean(parentId), references: clean(parentId)} : {}),
    textEncoding: 'base64', disableFileAccess: true, disableUrlAccess: true,
  }).compile().build();
}

let timer, running;
const queued = new Map();
async function syncConnectedMailbox(id) {
  const mailbox = await getModels().GmailMailbox.findByPk(id, {attributes: ['id', 'provider']});
  if (!mailbox) return;
  if (mailbox.provider && mailbox.provider !== 'gmail') return require('./hostinger-tickets').syncMailbox(id);
  return syncMailbox(id);
}
function queueSync(id) {
  if (queued.has(id)) return;
  const task = new Promise(resolve => setImmediate(resolve)).then(() => syncConnectedMailbox(id)).catch(() => {}).finally(() => queued.delete(id));
  queued.set(id, task);
}
function startGmailTicketJob() {
  if (timer || process.env.EMAIL_TICKET_SYNC_ENABLED === 'false' || (!configured() && !require('./hostinger-tickets').configured())) return;
  const tick = () => {
    if (running) return;
    running = (async () => {
      const models = getModels();
      await models.GmailOAuthState.destroy({where: {expiresAt: {[Op.lt]: new Date()}}});
      const boxes = await models.GmailMailbox.findAll({where: {[Op.or]: [{encryptedRefreshToken: {[Op.ne]: null}}, {encryptedPassword: {[Op.ne]: null}}]}, attributes: ['id', 'provider']});
      for (const box of boxes) {
        if (box.provider === 'gmail' && process.env.GMAIL_SYNC_ENABLED === 'false') continue;
        if (!queued.has(box.id)) await syncConnectedMailbox(box.id);
      }
    })().catch(() => console.error('[gmail-tickets] Background sync unavailable; check migrations and configuration.')).finally(() => {running = null;});
  };
  timer = setInterval(tick, 60000); timer.unref(); tick();
}
async function stopGmailTicketJob() { clearInterval(timer); timer = null; if (running) await running; await Promise.allSettled([...queued.values()]); }
module.exports = {SCOPES, configured, encrypt, decrypt, redirectUri, tokenRequest, accessToken, gmail, header, emailAddress, plainBody, importThread, syncMailbox, replyMime, queueSync, startGmailTicketJob, stopGmailTicketJob};
