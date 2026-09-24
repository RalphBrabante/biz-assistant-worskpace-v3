const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const hostinger = require('../src/services/hostinger-tickets');
const gmail = require('../src/services/gmail-tickets');
const tx = {LOCK: {UPDATE: 'UPDATE'}};
function sandbox(file, overrides = {}, globals = {}) {
  const filename = path.resolve(__dirname, file), real = createRequire(filename), module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {module, exports: module.exports, console: {error() {}}, Buffer, Date, URLSearchParams, process, ...globals, require: name => overrides[name] || real(name)});
  return module.exports;
}
function response() {return {statusCode: 200, set() {return this;}, status(code) {this.statusCode = code; return this;}, json(value) {this.body = value; return this;}};}
function connectionSetup({valid = true, foreign = false} = {}) {
  const writes = [], verifies = [], reads = [];
  const models = {Organization: {findByPk: async id => ({id})}, GmailMailbox: {
    sequelize: {transaction: fn => fn(tx)},
    findOne: async query => {reads.push(query.where); return Object.getOwnPropertySymbols(query.where.organizationId || {}).length && foreign ? {id: 'foreign'} : null;},
    create: async values => {writes.push(values);},
  }};
  const provider = {...hostinger, configured: () => true, encrypt: () => 'encrypted-password', verifyCredentials: async (...args) => {verifies.push(args); if (!valid) throw new Error('private-provider-error');}};
  const c = sandbox('../src/controllers/tickets-controller.js', {'../sequelize': {getModels: () => models}, '../services/hostinger-tickets': provider});
  const req = {auth: {userId: 'admin', user: {organizationId: 'org-a'}, roleCodes: ['administrator']}, query: {organizationId: 'org-b'}, body: {organizationId: 'org-b', provider: 'hostinger', email: 'support@example.com', password: 'mailbox-password'}};
  return {c, req, writes, reads, verifies};
}
test('frontend connection uses the authenticated organization and saves only encrypted credentials', async () => {
  const e = connectionSetup(), res = response(); await e.c.connectHostinger(e.req, res);
  assert.equal(res.statusCode, 200); assert.equal(e.writes[0].organizationId, 'org-a'); assert.equal(e.writes[0].encryptedPassword, 'encrypted-password');
  assert.equal(e.writes[0].email, 'support@example.com'); assert.equal(e.writes[0].password, undefined);
  assert.doesNotMatch(JSON.stringify(res.body), /mailbox-password|encrypted-password/); assert.equal(e.verifies.length, 1);
});
test('a mailbox belonging to another organization cannot be connected or probed', async () => {
  const e = connectionSetup({foreign: true}), res = response(); await e.c.connectHostinger(e.req, res);
  assert.equal(res.statusCode, 409); assert.equal(e.writes.length, 0); assert.equal(e.verifies.length, 0);
});
test('failed IMAP/SMTP credential checks never save the password or echo provider errors', async () => {
  const e = connectionSetup({valid: false}), res = response(); await e.c.connectHostinger(e.req, res);
  assert.equal(res.statusCode, 400); assert.equal(e.writes.length, 0); assert.doesNotMatch(JSON.stringify(res.body), /private-provider-error|mailbox-password/);
});
test('provider selection rejects arbitrary hosts and credentials are never hardcoded', async () => {
  assert.throws(() => hostinger.providerConfig('localhost')); assert.throws(() => hostinger.providerConfig('__proto__'));
  assert.equal(hostinger.providerConfig('hostinger').imap, 'imap.hostinger.com');
  const e = connectionSetup(), res = response(); e.req.body.provider = 'custom'; await e.c.connectHostinger(e.req, res);
  assert.equal(res.statusCode, 400); assert.equal(e.verifies.length, 0);
});
test('viewers cannot manage organization mailbox connections', () => {
  const e = connectionSetup(), res = response(); e.req.auth.roleCodes = ['staff'];
  e.c.admin(e.req, res, () => assert.fail('should not authorize')); assert.equal(res.statusCode, 403);
});
test('Hostinger password encryption round-trips without needing Google OAuth configuration', () => {
  const provider = sandbox('../src/services/hostinger-tickets.js', {}, {process: {env: {EMAIL_TICKET_ENCRYPTION_KEY: 'a'.repeat(64)}}});
  assert.equal(provider.configured(), true); const value = provider.encrypt('secret-password');
  assert.doesNotMatch(value, /secret-password/); assert.equal(provider.decrypt(value), 'secret-password');
  assert.throws(() => provider.decrypt(value.slice(0, -5) + 'AAAAA'));
});
function importSetup() {
  const tickets = [], messages = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const models = {
    Customer: {findAll: async () => []},
    EmailTicket: {findOne: async query => tickets.find(row => matches(row, query.where)) || null, create: async values => {const row = {id: `ticket-${tickets.length}`, version: 0, status: 'open', ...values, update: async function(v) {Object.assign(this, v);}}; tickets.push(row); return row;}},
    TicketMessage: {findOne: async query => messages.find(row => matches(row, query.where)) || null, create: async values => {const row = {...values, update: async function(v) {Object.assign(this,v);}}; messages.push(row); return row;}},
  };
  return {models, tickets, messages};
}
const parsed = {messageId: '<original@example.com>', subject: 'Help', from: {value: [{address: 'customer@example.com'}]}, text: 'Please help.'};
const mailboxA = {id: 'mailbox-a', organizationId: 'org-a', email: 'support-a@example.com'};
const source = {identity: 'INBOX:1:1', date: new Date(1000), sentFolder: false};
test('each organization gets separate tickets even for the same Message-ID', async () => {
  const e = importSetup();
  await hostinger.importMessage(e.models, mailboxA, parsed, source, tx);
  await hostinger.importMessage(e.models, {...mailboxA, id: 'mailbox-b', organizationId: 'org-b'}, parsed, source, tx);
  assert.equal(e.tickets.length, 2); assert.equal(e.messages[0].organizationId, 'org-a'); assert.equal(e.messages[1].organizationId, 'org-b');
});
test('IMAP references group replies, deduplicate messages across UID resets, and reopen tickets', async () => {
  const e = importSetup(); await hostinger.importMessage(e.models, mailboxA, parsed, source, tx);
  e.tickets[0].status = 'resolved';
  const reply = {...parsed, messageId: '<reply@example.com>', inReplyTo: parsed.messageId, text: 'Another question'};
  await hostinger.importMessage(e.models, mailboxA, reply, {...source, identity: 'INBOX:1:2', date: new Date(2000)}, tx);
  await hostinger.importMessage(e.models, mailboxA, reply, {...source, identity: 'INBOX:2:30', date: new Date(2000)}, tx);
  assert.equal(e.tickets.length, 1); assert.equal(e.messages.length, 2); assert.equal(e.tickets[0].status, 'open');
});
test('references cannot attach an organization’s email to another organization’s ticket', async () => {
  const e = importSetup(); await hostinger.importMessage(e.models, mailboxA, parsed, source, tx);
  await hostinger.importMessage(e.models, {...mailboxA, id: 'mailbox-b', organizationId: 'org-b'}, {...parsed, messageId: '<new@example.com>', inReplyTo: parsed.messageId}, source, tx);
  assert.equal(e.tickets.length, 2); assert.notEqual(e.messages[0].ticketId, e.messages[1].ticketId);
});
test('a Sent copy reconciles uncertain SMTP delivery instead of creating a duplicate', async () => {
  const e = importSetup(); await hostinger.importMessage(e.models, mailboxA, parsed, source, tx);
  e.messages[0].kind = 'outbound'; e.messages[0].deliveryStatus = 'unknown';
  await hostinger.importMessage(e.models, mailboxA, parsed, {...source, sentFolder: true}, tx);
  assert.equal(e.messages.length, 1); assert.equal(e.messages[0].deliveryStatus, 'sent');
});
test('Hostinger verifies TLS IMAP and SMTP without sending a test email', async () => {
  const calls = []; let imapOptions, smtpOptions;
  class Imap {constructor(options) {imapOptions = options;} on() {} async connect() {calls.push('imap');} async mailboxOpen(path, options) {assert.equal(path, 'INBOX'); assert.equal(options.readOnly, true);} close() {}}
  const service = sandbox('../src/services/hostinger-tickets.js', {imapflow: {ImapFlow: Imap}, nodemailer: {createTransport: options => {smtpOptions = options; return {verify: async () => calls.push('smtp'), close() {}, sendMail() {assert.fail('no email should be sent');}};}}});
  await service.verifyCredentials('hostinger', 'org@example.com', 'password');
  assert.deepEqual(calls, ['imap', 'smtp']); assert.equal(imapOptions.port, 993); assert.equal(smtpOptions.port, 465);
  assert.equal(imapOptions.secure, true); assert.equal(smtpOptions.tls.rejectUnauthorized, true); assert.equal(imapOptions.logger, false);
});
test('SMTP success survives a failed Sent-folder copy and sends only once', async () => {
  let sends = 0;
  class Imap {on() {} async connect() {throw new Error('IMAP unavailable');} close() {}}
  const service = sandbox('../src/services/hostinger-tickets.js', {imapflow: {ImapFlow: Imap}, nodemailer: {createTransport: () => ({sendMail: async () => {sends++; return {accepted: ['customer@example.com']};}, close() {}})}, './gmail-tickets': {...gmail, replyMime: async () => Buffer.from('email')}}, {process: {env: {EMAIL_TICKET_ENCRYPTION_KEY: 'a'.repeat(64)}}});
  const result = await service.sendReply({...mailboxA, provider: 'hostinger', encryptedPassword: service.encrypt('password')}, {requesterEmail: 'customer@example.com'}, {internetMessageId: '<sent@example.com>'}, 'body', null, () => {});
  assert.equal(sends, 1); assert.match(result.warning, /accepted by SMTP/); assert.equal(result.externalMessageKey, hostinger.messageKey('<sent@example.com>'));
});
function syncSetup({lastUid = 0, count = 27, failFetch = false} = {}) {
  const searches = [], opens = [], writes = [];
  const mailbox = {id: 'box', provider: 'hostinger', email: 'support@example.com', organizationId: 'org-a', imapState: {INBOX: {validity: '10', lastUid}}, update: async function(values) {writes.push(values); Object.assign(this, values);}};
  class Imap {
    on() {} async connect() {} async list() {return [];}
    async mailboxOpen(name, options) {opens.push(options);return {uidValidity: 10n, uidNext: count + 1};}
    async search(criteria) {searches.push(criteria); const start = Number(criteria.uid.split(':')[0]); return Array.from({length: Math.max(0,count-start+1)}, (_,i)=>start+i);}
    async fetchOne(uid, fields) {if(failFetch) throw new Error('secret-provider-response');return fields.source ? {source: Buffer.from(String(uid))} : {size: 10, internalDate: new Date(1000)};}
    close() {}
  }
  const models = {GmailMailbox: {sequelize: {transaction: fn=>fn(tx)}, findByPk: async ()=>mailbox, update: async values=>writes.push(values)}, TicketMessage: {findOne: async ()=>({kind:'inbound'})}};
  const service = sandbox('../src/services/hostinger-tickets.js', {imapflow:{ImapFlow:Imap}, '../sequelize':{getModels:()=>models}, mailparser:{simpleParser:async source=>({messageId:`<${source.toString()}@example.com>`})}}, {process:{env:{EMAIL_TICKET_ENCRYPTION_KEY:'a'.repeat(64)}}});
  mailbox.encryptedPassword = service.encrypt('password');
  return {service, mailbox, searches, opens, writes};
}
test('IMAP pagination persists each completed batch and continues by UID without marking mail read', async () => {
  const e = syncSetup(); await e.service.syncMailbox('box');
  assert.equal(e.mailbox.imapState.INBOX.lastUid,25); assert.equal(e.mailbox.pageToken,'imap-more');
  await e.service.syncMailbox('box'); assert.equal(e.mailbox.imapState.INBOX.lastUid,27); assert.equal(e.mailbox.pageToken,null);
  assert.equal(e.searches[0].uid,'1:27'); assert.equal(e.searches[1].uid,'26:27'); assert(e.opens.every(options=>options.readOnly));
});
test('a caught-up inbox avoids the reversed IMAP UID n:* edge case', async () => {
  const e = syncSetup({lastUid:27}); await e.service.syncMailbox('box'); assert.equal(e.searches.length,0);
});
test('failed IMAP fetch keeps the checkpoint and hides provider error details', async () => {
  const e = syncSetup({lastUid:5,failFetch:true}); await e.service.syncMailbox('box');
  assert.equal(e.mailbox.imapState.INBOX.lastUid,5); assert.equal(e.writes.length,1);
  assert.match(e.writes[0].lastError,/sync failed/); assert.doesNotMatch(e.writes[0].lastError,/secret-provider-response/);
});
