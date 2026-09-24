const addressParser = require('nodemailer/lib/addressparser');
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const fail = (status, message) => Object.assign(new Error(message), {status});
function addresses(value) {
  const result = [];
  const walk = items => { for (const item of items.filter(Boolean)) {
    if (item.group) walk(item.group);
    const address = String(item.address || '').trim().toLowerCase();
    if (/^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(address) && address.length <= 255 && !result.includes(address)) result.push(address);
  } };
  if (Array.isArray(value)) walk(value.map(item => typeof item === 'string' ? {address: item} : item));
  else walk(addressParser(String(value || '').replace(/[\r\n]+[ \t]*/g, ' ')));
  return result;
}
function messageIds(value) { return [...new Set((Array.isArray(value) ? value.join(' ') : String(value || '')).match(/<[^<>\r\n]{1,996}>/g) || [])].slice(-50); }
function recipients(parent, ticket, mailbox, mode = 'reply') {
  const envelope = parent?.envelope || {};
  const self = String(mailbox.email).toLowerCase();
  const other = values => addresses(values).filter(email => email !== self);
  let to = other(parent?.kind === 'outbound' ? envelope.to : (envelope.replyTo?.length ? envelope.replyTo : [parent?.sender || ticket.requesterEmail]));
  if (!to.length) to = other([ticket.requesterEmail]);
  let cc = [];
  if (mode === 'replyAll') {
    if (!parent?.envelope) throw fail(409, 'Load the original email details before using reply-all.');
    if (parent.kind !== 'outbound') to = [...new Set([...to, ...other(envelope.to)])];
    cc = other(envelope.cc).filter(email => !to.includes(email));
  }
  if (!to.length) throw fail(400, 'This email has no reply recipient.');
  if (to.length + cc.length > 100) throw fail(400, 'This email has too many recipients to reply from tickets.');
  return {to, cc};
}
function filename(value) { return String(value || 'attachment').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'attachment'; }
function contentType(value) { return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value || '') ? value.toLowerCase() : 'application/octet-stream'; }
function uploads(files = []) {
  if (files.length > MAX_FILES || files.reduce((sum, file) => sum + file.buffer.length, 0) > MAX_ATTACHMENT_BYTES) throw fail(413, 'Attach up to 10 files, totaling no more than 10 MB.');
  return files.map(file => ({filename: filename(file.originalname), contentType: contentType(file.mimetype), size: file.buffer.length, content: file.buffer}));
}
async function saveAttachments(models, message, files, transaction) {
  for (const file of files) await models.TicketAttachment.create({organizationId: message.organizationId, ticketId: message.ticketId, messageId: message.id, ...file}, {transaction});
}
function imapEnvelope(parsed) {
  return {to: addresses(parsed.to?.value), cc: addresses(parsed.cc?.value), replyTo: addresses(parsed.replyTo?.value), references: messageIds(parsed.references), inReplyTo: messageIds(parsed.inReplyTo)[0] || null, subject: String(parsed.subject || '').slice(0, 500)};
}
async function enrichImap(models, message, parsed, transaction) {
  if (message.envelope) return;
  let total = 0;
  const files = (parsed.attachments || []).map(file => {
    const size = file.content?.length || file.size || 0; total += size;
    return {filename: filename(file.filename), contentType: contentType(file.contentType), size, content: total <= MAX_ATTACHMENT_BYTES ? file.content : null, unavailable: total > MAX_ATTACHMENT_BYTES};
  });
  await saveAttachments(models, message, files, transaction);
  await message.update({envelope: imapEnvelope(parsed)}, {transaction});
}
module.exports = {MAX_ATTACHMENT_BYTES, MAX_FILES, addresses, messageIds, recipients, filename, contentType, uploads, saveAttachments, imapEnvelope, enrichImap};
