const crypto = require('crypto');
const {Op} = require('sequelize');
const {getModels} = require('../sequelize');
const {emailAddress, replyMime} = require('./gmail-tickets');
const conversation = require('./ticket-conversation');
const PROVIDERS = Object.freeze({
  hostinger: {imap: 'imap.hostinger.com', smtp: 'smtp.hostinger.com', webmail: 'https://mail.hostinger.com/'},
  titan: {imap: 'imap.titan.email', smtp: 'smtp.titan.email', webmail: 'https://app.titan.email/'},
});
function key() {
  const value = process.env.EMAIL_TICKET_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY || '';
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('Configure EMAIL_TICKET_ENCRYPTION_KEY on the server.');
  return Buffer.from(value, 'hex');
}
function configured() { try { key(); return true; } catch { return false; } }
function encrypt(password) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}
function decrypt(value) {
  const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', key(), iv); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
function providerConfig(provider) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Choose Hostinger Email or Titan Email.');
  return PROVIDERS[provider];
}
function imapClient(provider, email, password) {
  const {ImapFlow} = require('imapflow');
  const client = new ImapFlow({host: providerConfig(provider).imap, port: 993, secure: true,
    auth: {user: email, pass: password}, logger: false, logRaw: false, disableAutoIdle: true,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, tls: {rejectUnauthorized: true, minVersion: 'TLSv1.2'}});
  // ImapFlow also emits connection errors; the awaited operation reports the failure.
  client.on('error', () => {});
  return client;
}
function smtpClient(provider, email, password) {
  return require('nodemailer').createTransport({host: providerConfig(provider).smtp, port: 465, secure: true,
    auth: {user: email, pass: password}, logger: false, debug: false,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    tls: {rejectUnauthorized: true, minVersion: 'TLSv1.2'}});
}
async function verifyCredentials(provider, email, password) {
  const client = imapClient(provider, email, password), smtp = smtpClient(provider, email, password);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', {readOnly: true});
    await smtp.verify(); // Verifies login only. No email is sent.
  } finally { client.close(); smtp.close(); }
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function messageKey(messageId, fallback) { return messageId ? `mid:${hash(messageId)}` : `uid:${hash(fallback)}`; }
function messageIds(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '');
  return (text.match(/<[^<>\r\n]{1,996}>/g) || []).slice(-50);
}
async function importMessage(models, mailbox, parsed, source, transaction) {
  const mid = messageIds(parsed.messageId)[0] || null;
  const externalMessageKey = messageKey(mid, source.identity);
  const existing = await models.TicketMessage.findOne({where: {mailboxId: mailbox.id, externalMessageKey}, transaction});
  if (existing) {
    const needsDetails = !existing.envelope;
    await conversation.enrichImap(models, existing, parsed, transaction);
    if (needsDetails) {
      const ticket = await models.EmailTicket.findOne({where: {id: existing.ticketId, organizationId: mailbox.organizationId, mailboxId: mailbox.id}, transaction, lock: transaction.LOCK.UPDATE});
      if (ticket) await ticket.update({version: ticket.version + 1}, {transaction});
    }
    if (existing.kind === 'outbound' && existing.deliveryStatus !== 'sent') await existing.update({deliveryStatus: 'sent', sender: mailbox.email, sentAt: source.date}, {transaction});
    return;
  }
  const references = [...new Set([...messageIds(parsed.references), ...messageIds(parsed.inReplyTo)])];
  let ticket = null;
  // Match only within this mailbox. Subjects alone never join unrelated requests.
  for (const reference of references.slice().reverse()) {
    const parent = await models.TicketMessage.findOne({where: {mailboxId: mailbox.id, externalMessageKey: messageKey(reference)}, transaction});
    if (parent) { ticket = await models.EmailTicket.findOne({where: {id: parent.ticketId, mailboxId: mailbox.id, organizationId: mailbox.organizationId}, transaction, lock: transaction.LOCK.UPDATE}); if (ticket) break; }
  }
  const externalThreadKey = `imap:${hash(references[0] || mid || source.identity)}`;
  if (!ticket) ticket = await models.EmailTicket.findOne({where: {mailboxId: mailbox.id, externalThreadKey, organizationId: mailbox.organizationId}, transaction, lock: transaction.LOCK.UPDATE});
  const sender = emailAddress(parsed.from?.value?.[0]?.address);
  const outbound = source.sentFolder || sender === mailbox.email;
  if (!ticket && outbound) return; // Sent-only conversations are not new support requests.
  let created = false;
  if (!ticket) {
    const requesterEmail = emailAddress(parsed.replyTo?.value?.[0]?.address) || sender;
    if (!requesterEmail) throw new Error('An incoming message has no valid sender address.');
    const customers = await models.Customer.findAll({where: {organizationId: mailbox.organizationId, email: requesterEmail, isActive: true}, attributes: ['id'], limit: 2, transaction});
    ticket = await models.EmailTicket.create({organizationId: mailbox.organizationId, mailboxId: mailbox.id, externalThreadKey,
      subject: String(parsed.subject || '(No subject)').slice(0, 500), requesterEmail,
      customerId: customers.length === 1 ? customers[0].id : null, lastMessageAt: source.date}, {transaction});
    created = true;
  }
  const attachments = (parsed.attachments || []).map(item => item.filename || 'Attachment').join(', ');
  const body = `${parsed.text || '[No text content. Open webmail to view this email.]'}${attachments ? `\n\nAttachments: ${attachments}` : ''}`.slice(0, 200000);
  const row = await models.TicketMessage.create({organizationId: mailbox.organizationId, mailboxId: mailbox.id, ticketId: ticket.id,
    externalMessageKey, internetMessageId: mid, kind: outbound ? 'outbound' : 'inbound', body, sender,
    deliveryStatus: 'sent', sentAt: source.date, createdAt: source.date}, {transaction});
  await conversation.enrichImap(models, row, parsed, transaction);
  const newer = source.date > new Date(ticket.lastMessageAt || 0);
  await ticket.update({version: ticket.version + 1,
    ...(newer ? {lastMessageAt: source.date} : {}),
    ...(!created && newer && !outbound && ['pending', 'resolved', 'closed'].includes(ticket.status) ? {status: 'open'} : {}),
  }, {transaction});
}
async function syncMailbox(id) {
  const models = getModels();
  try {
    await models.GmailMailbox.sequelize.transaction(async transaction => {
      const mailbox = await models.GmailMailbox.findByPk(id, {transaction, lock: transaction.LOCK.UPDATE});
      if (!mailbox?.encryptedPassword || !Object.hasOwn(PROVIDERS, mailbox.provider)) return;
      const client = imapClient(mailbox.provider, mailbox.email, decrypt(mailbox.encryptedPassword));
      try {
        await client.connect();
        const folders = await client.list();
        const sent = folders.find(folder => folder.specialUse === '\\Sent') || folders.find(folder => /^(INBOX[./])?Sent( Items| Mail)?$/i.test(folder.path));
        const state = {...(mailbox.imapState || {})};
        let importing = false;
        for (const folder of ['INBOX', ...(sent && sent.path !== 'INBOX' ? [sent.path] : [])]) {
          const selected = await client.mailboxOpen(folder, {readOnly: true});
          const validity = String(selected.uidValidity);
          const previous = state[folder]?.validity === validity ? state[folder] : null;
          const lastUid = Number(previous?.lastUid || 0);
          const upper = Number(selected.uidNext) - 1;
          if (lastUid >= upper) continue;
          // Numeric, bounded UID ranges avoid the IMAP n:* range reversal edge case.
          const criteria = {uid: `${lastUid + 1}:${upper}`, ...(previous ? {} : {since: new Date(Date.now() - 30 * 86400000)})};
          const uids = (await client.search(criteria, {uid: true}) || []).filter(uid => uid > lastUid && uid <= upper).sort((a,b) => a-b);
          const batch = uids.slice(0, 25);
          for (const uid of batch) {
            const metadata = await client.fetchOne(uid, {size: true, envelope: true, internalDate: true}, {uid: true});
            if (!metadata) continue; // Message removed between SEARCH and FETCH.
            let parsed;
            if (metadata.size > 10 * 1024 * 1024) {
              // Do not buffer oversized attachments; retain a ticket and the thread headers.
              const e = metadata.envelope || {};
              const headers = await client.fetchOne(uid, {headers: ['references', 'in-reply-to']}, {uid: true});
              const {simpleParser} = require('mailparser');
              const threadHeaders = await simpleParser(headers?.headers || Buffer.alloc(0));
              parsed = {subject: e.subject, messageId: e.messageId, inReplyTo: e.inReplyTo || threadHeaders.inReplyTo, references: threadHeaders.references,
                from: {value: e.from}, to: {value: e.to}, cc: {value: e.cc}, replyTo: {value: e.replyTo}, text: '[Email exceeds the 10 MB import limit. Open webmail to view its contents and attachments.]'};
            } else {
              const fetched = await client.fetchOne(uid, {source: true}, {uid: true});
              if (!fetched) continue;
              parsed = await require('mailparser').simpleParser(fetched.source, {skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true});
            }
            await importMessage(models, mailbox, parsed, {identity: `${folder}:${validity}:${uid}`, date: new Date(metadata.internalDate), sentFolder: folder !== 'INBOX'}, transaction);
          }
          importing ||= uids.length > batch.length;
          state[folder] = {validity, lastUid: uids.length > batch.length ? batch.at(-1) : upper};
        }
        await mailbox.update({imapState: state, pageToken: importing ? 'imap-more' : null, ...(!importing ? {lastSyncedAt: new Date()} : {}), lastError: null}, {transaction});
      } finally { client.close(); }
    });
  } catch {
    // Provider errors may contain addresses, credentials or message contents. Keep them private.
    await models.GmailMailbox.update({lastError: 'Mailbox sync failed. Check the mailbox password, provider, and IMAP access, then reconnect or retry.'}, {where: {id}});
  }
}
async function loadOriginal(mailbox, message) {
  if (!message.internetMessageId) throw Object.assign(new Error('The original message has no email identifier. Open webmail to view it.'), {status: 404});
  const client = imapClient(mailbox.provider, mailbox.email, decrypt(mailbox.encryptedPassword));
  try {
    await client.connect();
    const folders = await client.list();
    const sent = folders.find(folder => folder.specialUse === '\\Sent') || folders.find(folder => /^(INBOX[./])?Sent( Items| Mail)?$/i.test(folder.path));
    for (const folder of ['INBOX', ...(sent && sent.path !== 'INBOX' ? [sent.path] : [])]) {
      await client.mailboxOpen(folder, {readOnly: true});
      const uids = await client.search({header: {'Message-ID': message.internetMessageId}}, {uid: true});
      for (const uid of (uids || []).slice(-5)) {
        const metadata = await client.fetchOne(uid, {size: true}, {uid: true});
        if (!metadata) continue;
        if (metadata.size > conversation.MAX_ATTACHMENT_BYTES) throw Object.assign(new Error('This email exceeds the 10 MB import limit. Open webmail to view it.'), {status: 413});
        const fetched = await client.fetchOne(uid, {source: true}, {uid: true});
        if (!fetched) continue;
        const parsed = await require('mailparser').simpleParser(fetched.source, {skipTextToHtml: true, skipImageLinks: true});
        if (messageIds(parsed.messageId)[0] === message.internetMessageId) return parsed;
      }
    }
    throw Object.assign(new Error('The original email is no longer in the Inbox or Sent folder.'), {status: 404});
  } finally { client.close(); }
}
async function sendReply(mailbox, ticket, message, body, parentId, onSending, options = {}) {
  const password = decrypt(mailbox.encryptedPassword);
  const raw = await replyMime({mailbox, ticket, body, internetMessageId: message.internetMessageId, parentId, ...options});
  const smtp = smtpClient(mailbox.provider, mailbox.email, password);
  let deliveryWarning = null;
  try {
    onSending();
    const result = await smtp.sendMail({envelope: {from: mailbox.email, to: [...(options.to || [ticket.requesterEmail]), ...(options.cc || [])]}, raw});
    if (result.rejected?.length) deliveryWarning = 'Some recipients were rejected by the mail server. Accepted recipients were sent the reply; do not resend to everyone.';
    if (!result.accepted?.length) throw Object.assign(new Error('Recipient not accepted.'), {responseCode: 550});
  } finally { smtp.close(); }
  // SMTP acceptance is success even if appending the Sent copy fails. Never resend.
  const client = imapClient(mailbox.provider, mailbox.email, password);
  let warning = deliveryWarning;
  try {
    await client.connect();
    const folders = await client.list();
    const sent = folders.find(folder => folder.specialUse === '\\Sent') || folders.find(folder => /^(INBOX[./])?Sent( Items| Mail)?$/i.test(folder.path));
    if (!sent) throw new Error('No Sent folder.');
    await client.append(sent.path, raw, ['\\Seen'], new Date());
  } catch { warning = 'Reply accepted by SMTP, but its Sent-folder copy could not be saved. Do not resend it.'; }
  finally { client.close(); }
  return {externalMessageKey: messageKey(message.internetMessageId), warning};
}
module.exports = {PROVIDERS, configured, encrypt, decrypt, providerConfig, verifyCredentials, messageKey, messageIds, importMessage, syncMailbox, loadOriginal, sendReply};
