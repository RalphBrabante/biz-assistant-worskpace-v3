const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {createRequire} = require('node:module');
const gmail = require('../src/services/gmail-tickets');
const {Op} = require('sequelize');
function controller(models = {}, provider = gmail) {
  const filename = path.resolve(__dirname, '../src/controllers/tickets-controller.js');
  const real = createRequire(filename), module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {module, exports: module.exports, console: {error() {}}, process, Buffer, URLSearchParams, Date, require: name => name === '../sequelize' ? {getModels: () => models} : name === '../services/gmail-tickets' ? provider : real(name)});
  return module.exports;
}
function req(overrides = {}) { return {query: {}, body: {}, params: {id: 'ticket'}, auth: {userId: 'user', user: {organizationId: 'org-a'}, roleCodes: ['staff'], permissions: new Set(['tickets.read'])}, ...overrides}; }
function res() { return {statusCode: 200, headers: {}, set(k,v) {this.headers[k] = v; return this;}, status(n) {this.statusCode = n; return this;}, json(body) {this.body = body; return this;}, redirect(url) {this.redirectUrl = url; return this;}}; }
const tx = {LOCK: {UPDATE: 'UPDATE'}};
const database = {transaction: fn => fn(tx)};
test('ticket scope cannot be overridden by ordinary staff or administrators', () => {
  const c = controller();
  for (const role of ['staff', 'administrator']) assert.equal(c.scope(req({query: {organizationId: 'org-b'}, auth: {...req().auth, roleCodes: [role]}})).organizationId, 'org-a');
  assert.throws(() => c.scope(req({auth: {...req().auth, user: {}}})), /Select an organization/);
  assert.throws(() => c.scope(req({auth: {...req().auth, roleCodes: ['superuser']}})), /Select an organization/);
});
test('read permission does not grant replies or connection management', () => {
  const c = controller(), r = res(); let called = false;
  c.permit('tickets.reply')(req(), r, () => {called = true;}); assert.equal(r.statusCode, 403); assert.equal(called, false);
  const r2 = res(); c.admin(req(), r2, () => {}); assert.equal(r2.statusCode, 403);
});
test('list filters and pagination remain scoped and sort rejects SQL-like input', async () => {
  let query;
  const c = controller({EmailTicket: {findAndCountAll: async q => {query = q; return {rows: [], count: 60};}}});
  const r = res(); await c.list(req({query: {organizationId: 'org-b', assigneeId: 'me', page: '2', priority: '4', sort: 'priority'}}), r);
  assert.equal(query.where.organizationId, 'org-a'); assert.equal(query.where.assigneeId, 'user'); assert.equal(query.where.priority, 4); assert.equal(query.offset, 25); assert.equal(r.headers['Cache-Control'], 'no-store');
  const invalid = res(); await c.list(req({query: {sort: 'priority; DROP TABLE users'}}), invalid); assert.equal(invalid.statusCode, 400);
});
test('cross-organization ticket detail and note cannot be accessed', async () => {
  let writes = 0;
  const c = controller({EmailTicket: {sequelize: database, findOne: async q => {assert.equal(q.where.organizationId, 'org-a'); return null;}}, TicketMessage: {create: async () => {writes++;}}});
  for (const name of ['detail', 'note']) { const r = res(); await c[name](req({body: {body: 'test'}}), r); assert.equal(r.statusCode, 404); }
  assert.equal(writes, 0);
});
test('assignments reject customers and users outside the organization', async () => {
  const models = {Customer: {findOne: async q => {assert.equal(q.where.organizationId, 'org-a'); return null;}}, User: {findOne: async () => ({organizationId: 'org-b'})}, OrganizationUser: {findOne: async q => {assert.equal(q.where.organizationId, 'org-a'); return null;}}};
  const c = controller(models);
  await assert.rejects(c.fields(models, 'org-a', {customerId: 'foreign'}), /customer from this organization/);
  await assert.rejects(c.fields(models, 'org-a', {assigneeId: 'foreign'}), /teammate from this organization/);
  await assert.rejects(c.fields(models, 'org-a', {priority: 999}), /priority/);
  await assert.rejects(c.fields(models, 'org-a', {dueAt: 'bad-date'}), /due date/);
});
test('active secondary organization members may be assigned', async () => {
  const models = {User: {findOne: async () => ({organizationId: 'org-b'})}, OrganizationUser: {findOne: async q => q.where.isActive && {id: 'membership'}}};
  assert.equal(await controller(models).member(models, 'org-a', 'user'), true);
});
test('stale metadata version returns a conflict without writing', async () => {
  let writes = 0;
  const c = controller({EmailTicket: {sequelize: database, findOne: async () => ({version: 2, update: async () => {writes++;}})}});
  const r = res(); await c.update(req({body: {version: 1, status: 'resolved'}}), r); assert.equal(r.statusCode, 409); assert.equal(writes, 0);
});
test('a repeated reply key returns its existing delivery state without sending', async () => {
  let sends = 0;
  const c = controller({EmailTicket: {sequelize: database, findOne: async () => ({id: 'ticket', organizationId: 'org-a'})}, TicketMessage: {findOne: async () => ({deliveryStatus: 'sent'})}}, {...gmail, gmail: async () => {sends++;}});
  const r = res(); await c.reply(req({body: {body: 'Hello', requestKey: '11111111-1111-4111-8111-111111111111'}}), r);
  assert.equal(r.statusCode, 200); assert.equal(r.body.data.deliveryStatus, 'sent'); assert.equal(sends, 0);
});
test('Gmail refresh token encryption is authenticated and does not expose plaintext', () => {
  const previous = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  try {
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    const encrypted = gmail.encrypt('private-refresh-token'); assert.equal(encrypted.includes('private-refresh-token'), false); assert.equal(gmail.decrypt(encrypted), 'private-refresh-token');
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64); assert.throws(() => gmail.decrypt(encrypted));
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'invalid'; assert.equal(gmail.configured(), false);
  } finally { if (previous === undefined) delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY; else process.env.GMAIL_TOKEN_ENCRYPTION_KEY = previous; }
});
test('email parser rejects header injection and keeps MIME attachments out of body', () => {
  assert.equal(gmail.emailAddress('Customer <CLIENT@example.com>'), 'client@example.com');
  assert.equal(gmail.emailAddress('a@example.com\r\nBcc: victim@example.com'), '');
  const payload = {parts: [{mimeType: 'text/plain', body: {data: Buffer.from('Hello').toString('base64url')}}, {filename: 'private.txt', mimeType: 'text/plain', body: {data: Buffer.from('attachment-secret').toString('base64url')}}, {mimeType: 'text/html', body: {data: Buffer.from('<script>alert(1)</script>').toString('base64url')}}]};
  const body = gmail.plainBody(payload); assert.match(body, /Hello/); assert.match(body, /private.txt/); assert.doesNotMatch(body, /attachment-secret|<script>/);
});
test('reply MIME preserves threading and encodes Unicode body without header injection', async () => {
  const raw = (await gmail.replyMime({mailbox: {email: 'support@example.com'}, ticket: {requesterEmail: 'client@example.com', subject: 'Hi\r\nBcc: evil@example.com'}, body: 'Hello 世界', internetMessageId: '<new@example.com>', parentId: '<parent@example.com>'})).toString();
  assert.match(raw, /In-Reply-To: <parent@example.com>/); assert.match(raw, /References: <parent@example.com>/); assert.doesNotMatch(raw, /\r\nBcc:/); assert.match(raw, new RegExp(Buffer.from('Hello 世界').toString('base64')));
});
test('expired and replayed OAuth state is rejected before token exchange', async () => {
  let exchanges = 0;
  const provider = {...gmail, tokenRequest: async () => {exchanges++;}};
  for (const expired of [true, false]) {
    const c = controller({GmailOAuthState: {findByPk: async () => ({expiresAt: new Date(Date.now() + (expired ? -1000 : 10000))}), destroy: async () => 0}}, provider);
    const r = res(); await c.callback(req({query: {state: 'a'.repeat(64), code: 'code'}}), r); assert.equal(r.statusCode, 400);
  }
  assert.equal(exchanges, 0);
});
test('import deduplicates messages and reopens a resolved ticket on a new inbound message', async () => {
  const rows = []; const ticket = {id: 'ticket', organizationId: 'org-a', version: 1, status: 'resolved', lastMessageAt: new Date(1000), update: async function(values) {Object.assign(this, values);}};
  const models = {EmailTicket: {findOne: async () => ticket}, TicketMessage: {findOne: async q => rows.find(row => q.where.gmailMessageId && row.gmailMessageId === q.where.gmailMessageId) || null, create: async values => {rows.push(values);}}};
  const thread = {id: 'thread', messages: [{id: 'email1', internalDate: '2000', labelIds: ['INBOX'], payload: {headers: [{name: 'From', value: 'client@example.com'}], mimeType: 'text/plain', body: {data: Buffer.from('Help').toString('base64url')}}}]};
  await gmail.importThread(models, {id: 'mailbox', email: 'support@example.com', organizationId: 'org-a'}, thread, tx);
  await gmail.importThread(models, {id: 'mailbox', email: 'support@example.com', organizationId: 'org-a'}, thread, tx);
  assert.equal(rows.length, 1); assert.equal(ticket.status, 'open'); assert.equal(ticket.version, 2); assert.equal(rows[0].organizationId, 'org-a');
});
test('ambiguous customer email never auto-assigns the first matching customer', async () => {
  let created;
  const models = {EmailTicket: {findOne: async () => null, create: async values => {created = values; return {id: 'ticket', version: 0, ...values, update: async () => {}};}}, Customer: {findAll: async q => {assert.equal(q.where.organizationId, 'org-a'); return [{id: 'a'}, {id: 'b'}];}}, TicketMessage: {findOne: async () => null, create: async () => {}}};
  await gmail.importThread(models, {id: 'mailbox', email: 'support@example.com', organizationId: 'org-a'}, {id: 'thread', messages: [{id: 'm', internalDate: '2000', labelIds: ['INBOX'], payload: {headers: [{name: 'From', value: 'client@example.com'}]}}]}, tx);
  assert.equal(created.customerId, null);
});
test('sync retains its window and page cursor until every page completes', async () => {
  const updates = [], urls = [];
  const mailbox = {id: 'mailbox', organizationId: 'org-a', email: 'support@example.com', lastSyncedAt: new Date('2026-01-01T00:00:00Z'), update: async function(values) {updates.push(values); Object.assign(this, values);}};
  const models = {GmailMailbox: {sequelize: database, findByPk: async () => mailbox, update: async () => assert.fail('unexpected sync error')}};
  const filename = path.resolve(__dirname, '../src/services/gmail-tickets.js'), real = createRequire(filename), module = {exports: {}};
  let pages = 0;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {module, exports: module.exports, Buffer, Date, URLSearchParams, AbortSignal, console, process: {env: {GMAIL_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64), GMAIL_CLIENT_ID: 'client', GMAIL_CLIENT_SECRET: 'secret'}}, require: name => name === '../sequelize' ? {getModels: () => models} : real(name), fetch: async (url) => {urls.push(url); return {ok: true, json: async () => url.includes('oauth2') ? {access_token: 'access'} : (++pages === 1 ? {threads: [], nextPageToken: 'page-two'} : {threads: []})};}});
  const service = module.exports; mailbox.encryptedRefreshToken = service.encrypt('refresh');
  await service.syncMailbox('mailbox');
  assert.equal(mailbox.pageToken, 'page-two'); assert.equal(mailbox.lastSyncedAt.toISOString(), '2026-01-01T00:00:00.000Z');
  const started = mailbox.syncStartedAt;
  await service.syncMailbox('mailbox');
  assert.equal(mailbox.pageToken, null); assert.equal(mailbox.syncStartedAt, null); assert.equal(mailbox.lastSyncedAt, started);
  const queries = urls.filter(url => url.includes('/threads?')).map(url => new URL(url).searchParams);
  assert.equal(queries[0].get('q'), queries[1].get('q')); assert.equal(queries[1].get('pageToken'), 'page-two');
});
test('a send timeout records an uncertain delivery instead of retrying the email', async () => {
  let sends = 0; let intentCommitted = false;
  const message = {internetMessageId: '<new@example.com>', deliveryStatus: 'sending', update: async function(values) {Object.assign(this, values);}};
  const ticket = {id: 'ticket', organizationId: 'org-a', mailboxId: 'mailbox', version: 0, update: async () => {}};
  const models = {EmailTicket: {sequelize: {transaction: async fn => {await fn(tx); intentCommitted = true;}}, findOne: async () => ticket}, TicketMessage: {findOne: async () => null, create: async () => message}, GmailMailbox: {sequelize: database, findOne: async () => ({email: 'support@example.com', encryptedRefreshToken: 'encrypted'})}};
  const provider = {...gmail, accessToken: async () => 'token', replyMime: async () => Buffer.from('mime'), gmail: async () => {assert.equal(intentCommitted, true); sends++; throw new Error('timeout');}};
  const r = res(); await controller(models, provider).reply(req({body: {body: 'Hello', version: 0, requestKey: '11111111-1111-4111-8111-111111111111'}}), r);
  assert.equal(message.deliveryStatus, 'unknown'); assert.equal(sends, 1); assert.equal(r.body.data.deliveryStatus, 'unknown');
});
