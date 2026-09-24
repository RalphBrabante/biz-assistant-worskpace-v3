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
  const models = {EmailTicket: {findOne: async () => ticket}, TicketMessage: {findOne: async q => rows.find(row => q.where.gmailMessageId && row.gmailMessageId === q.where.gmailMessageId) || null, create: async values => {const row = {...values, update: async function(v) {Object.assign(this, v);}}; rows.push(row); return row;}}};
  const thread = {id: 'thread', messages: [{id: 'email1', internalDate: '2000', labelIds: ['INBOX'], payload: {headers: [{name: 'From', value: 'client@example.com'}], mimeType: 'text/plain', body: {data: Buffer.from('Help').toString('base64url')}}}]};
  await gmail.importThread(models, {id: 'mailbox', email: 'support@example.com', organizationId: 'org-a'}, thread, tx);
  await gmail.importThread(models, {id: 'mailbox', email: 'support@example.com', organizationId: 'org-a'}, thread, tx);
  assert.equal(rows.length, 1); assert.equal(ticket.status, 'open'); assert.equal(ticket.version, 2); assert.equal(rows[0].organizationId, 'org-a');
});
test('ambiguous customer email never auto-assigns the first matching customer', async () => {
  let created;
  const models = {EmailTicket: {findOne: async () => null, create: async values => {created = values; return {id: 'ticket', version: 0, ...values, update: async () => {}};}}, Customer: {findAll: async q => {assert.equal(q.where.organizationId, 'org-a'); return [{id: 'a'}, {id: 'b'}];}}, TicketMessage: {findOne: async () => null, create: async values => ({...values, update: async function(v) {Object.assign(this, v);}})}};
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
  const ticket = {id: 'ticket', organizationId: 'org-a', mailboxId: 'mailbox', requesterEmail: 'client@example.com', version: 0, update: async () => {}};
  const models = {EmailTicket: {sequelize: {transaction: async fn => {await fn(tx); intentCommitted = true;}}, findOne: async () => ticket}, TicketMessage: {findOne: async () => null, create: async values => Object.assign(message, values)}, GmailMailbox: {sequelize: database, findOne: async () => ({email: 'support@example.com', encryptedRefreshToken: 'encrypted'})}};
  const provider = {...gmail, accessToken: async () => 'token', replyMime: async () => Buffer.from('mime'), gmail: async () => {assert.equal(intentCommitted, true); sends++; throw new Error('timeout');}};
  const r = res(); await controller(models, provider).reply(req({body: {body: 'Hello', version: 0, requestKey: '11111111-1111-4111-8111-111111111111'}}), r);
  assert.equal(message.deliveryStatus, 'unknown'); assert.equal(sends, 1); assert.equal(r.body.data.deliveryStatus, 'unknown');
});

const conversation = require('../src/services/ticket-conversation');
test('reply-all preserves To/Cc, honors Reply-To, removes self and duplicates, and never includes Bcc', () => {
  const parent = {kind: 'inbound', sender: 'sender@example.com', envelope: {
    replyTo: ['reply@example.com'], to: ['support@example.com', 'person@example.com'],
    cc: ['PERSON@example.com', 'cc@example.com', 'support@example.com'], bcc: ['hidden@example.com'],
  }};
  const target = conversation.recipients(parent, {requesterEmail: 'requester@example.com'}, {email: 'support@example.com'}, 'replyAll');
  assert.deepEqual(target, {to: ['reply@example.com', 'person@example.com'], cc: ['cc@example.com']});
  assert.deepEqual(conversation.recipients(parent, {}, {email: 'support@example.com'}), {to: ['reply@example.com'], cc: []});
  assert.throws(() => conversation.recipients({sender: 'a@example.com'}, {}, {email: 'support@example.com'}, 'replyAll'), /Load the original/);
  assert.deepEqual(conversation.addresses('"Last, First" <one@example.com>, Team: two@example.com, ONE@example.com;'), ['one@example.com', 'two@example.com']);
});
test('reply MIME includes recipient headers, a reference chain and binary attachments', async () => {
  const content = Buffer.from([0, 1, 2, 255]);
  const raw = await gmail.replyMime({mailbox: {email: 'support@example.com'}, ticket: {subject: 'Original subject'}, body: 'Reply', internetMessageId: '<reply@example.com>', parentId: '<parent@example.com>', references: ['<root@example.com>'], to: ['person@example.com'], cc: ['cc@example.com'], attachments: [{filename: 'résumé.bin', content, contentType: 'application/octet-stream'}]});
  const parsed = await require('mailparser').simpleParser(raw);
  assert.deepEqual(parsed.to.value.map(p => p.address), ['person@example.com']);
  assert.deepEqual(parsed.cc.value.map(p => p.address), ['cc@example.com']);
  assert.deepEqual(parsed.references, ['<root@example.com>', '<parent@example.com>']);
  assert.equal(parsed.inReplyTo, '<parent@example.com>');
  assert.equal(parsed.attachments[0].filename, 'résumé.bin');
  assert.deepEqual(parsed.attachments[0].content, content);
});
test('Gmail enrichment stores metadata and attachment references once without putting bytes in conversation JSON', async () => {
  const attachments = [];
  const row = {id: 'm', organizationId: 'org-a', ticketId: 't', update: async function(v) {Object.assign(this, v);}};
  const models = {TicketAttachment: {create: async value => attachments.push(value)}};
  const original = {payload: {headers: [{name: 'To', value: 'support@example.com'}, {name: 'Cc', value: 'cc@example.com'}], parts: [{filename: 'file.pdf', mimeType: 'application/pdf', body: {size: 15, attachmentId: 'remote-file'}}]}};
  await gmail.enrichMessage(models, row, original, tx); await gmail.enrichMessage(models, row, original, tx);
  assert.equal(attachments.length, 1); assert.equal(attachments[0].providerAttachmentId, 'remote-file');
  assert.equal(attachments[0].content, null); assert.equal(attachments[0].organizationId, 'org-a');
  assert.deepEqual(row.envelope.cc, ['cc@example.com']);
});
test('IMAP enrichment retains downloadable files and recipient history after mailbox disconnect', async () => {
  const files = [], row = {id: 'message', ticketId: 'ticket', organizationId: 'org', update: async function(v) {Object.assign(this, v);}};
  const models = {TicketAttachment: {create: async v => files.push(v)}};
  await conversation.enrichImap(models, row, {to: {value: [{address: 'support@example.com'}]}, cc: {value: [{address: 'cc@example.com'}]}, references: ['<root@example.com>'], attachments: [{filename: '../../bill.txt', contentType: 'text/plain', content: Buffer.from('invoice')}]}, tx);
  assert.equal(files[0].filename, 'bill.txt'); assert.equal(files[0].content.toString(), 'invoice');
  assert.deepEqual(row.envelope.references, ['<root@example.com>']); assert.deepEqual(row.envelope.cc, ['cc@example.com']);
  await conversation.enrichImap(models, row, {}, tx); assert.equal(files.length, 1);
});
function replyFixture() {
  let sends = 0; const files = [], messages = [], sentRequests = [];
  const parent = {id: 'parent', kind: 'inbound', sender: 'client@example.com', internetMessageId: '<parent@example.com>', envelope: {to: ['support@example.com', 'other@example.com'], cc: ['cc@example.com'], references: ['<root@example.com>']}};
  const ticket = {id: 'ticket', organizationId: 'org-a', mailboxId: 'box', gmailThreadId: 'thread', subject: 'Help', requesterEmail: 'client@example.com', version: 0, update: async function(v) {Object.assign(this, v);}};
  const models = {
    EmailTicket: {sequelize: database, findOne: async () => ticket, update: async () => {}},
    GmailMailbox: {sequelize: database, findOne: async () => ({email: 'support@example.com', encryptedRefreshToken: 'encrypted'})},
    TicketMessage: {
      findOne: async q => q.where.requestKey ? messages.find(m => m.requestKey === q.where.requestKey) : (!q.where.id || q.where.id === parent.id) ? parent : null,
      create: async values => {const row = {id: 'outbound', ...values, update: async function(v) {Object.assign(this, v);}}; messages.push(row); return row;},
    },
    TicketAttachment: {create: async v => files.push(v)},
  };
  const provider = {...gmail, accessToken: async () => 'token', gmail: async (_token, _path, options) => {sends++; sentRequests.push(JSON.parse(options.body)); return {id: 'sent'};}};
  const request = req({files: [{originalname: 'file.txt', mimetype: 'text/plain', buffer: Buffer.from('file contents')}], body: {body: 'Hello', version: '0', mode: 'replyAll', replyToMessageId: 'parent', requestKey: '11111111-1111-4111-8111-111111111111'}});
  return {c: controller(models, provider), request, files, messages, sentRequests, get sends() {return sends;}};
}
test('reply-all sends once, saves attachments and target, and preserves Gmail threading', async () => {
  const e = replyFixture(); const r = res(); await e.c.reply(e.request, r);
  assert.equal(r.body.data.deliveryStatus, 'sent'); assert.equal(e.sends, 1); assert.equal(e.files.length, 1);
  assert.equal(e.messages[0].envelope.replyToMessageId, 'parent'); assert.equal(e.sentRequests[0].threadId, 'thread');
  const parsed = await require('mailparser').simpleParser(Buffer.from(e.sentRequests[0].raw, 'base64url'));
  assert.deepEqual(parsed.to.value.map(p => p.address), ['client@example.com', 'other@example.com']);
  assert.deepEqual(parsed.cc.value.map(p => p.address), ['cc@example.com']); assert.equal(parsed.attachments[0].content.toString(), 'file contents');
  await e.c.reply(e.request, res()); assert.equal(e.sends, 1); assert.equal(e.files.length, 1);
});
test('reply cannot target another ticket and upload limits fail before any send', async () => {
  const e = replyFixture(); e.request.body.replyToMessageId = 'foreign'; const r = res(); await e.c.reply(e.request, r);
  assert.equal(r.statusCode, 404); assert.equal(e.sends, 0);
  assert.throws(() => conversation.uploads(Array.from({length: 11}, () => ({buffer: Buffer.alloc(0)}))), /up to 10/);
  assert.throws(() => conversation.uploads([{buffer: Buffer.alloc(10 * 1024 * 1024 + 1)}]), /10 MB/);
});
test('attachment downloads enforce organization, ticket and message boundaries and serve safe headers', async () => {
  let query;
  const models = {EmailTicket: {findOne: async () => ({id: 'ticket', organizationId: 'org-a'})}, TicketAttachment: {unscoped: () => ({findOne: async q => {query = q; return null;}})}};
  const c = controller(models), request = req({params: {id: 'ticket', messageId: 'message', attachmentId: 'foreign'}});
  const denied = res(); await c.attachment(request, denied); assert.equal(denied.statusCode, 404);
  assert.equal(query.where.organizationId, 'org-a'); assert.equal(query.where.ticketId, 'ticket'); assert.equal(query.where.messageId, 'message');
  models.TicketAttachment.unscoped = () => ({findOne: async () => ({filename: '../evil.html', contentType: 'text/html', size: 3, content: Buffer.from('abc')})});
  const response = res(); response.attachment = name => {response.filename = name;}; response.type = type => {response.mime = type;}; response.send = content => {response.content = content;};
  await c.attachment(request, response);
  assert.equal(response.filename, 'evil.html'); assert.equal(response.headers['X-Content-Type-Options'], 'nosniff'); assert.match(response.headers['Content-Security-Policy'], /sandbox/); assert.equal(response.content.toString(), 'abc');
});
test('conversation pages preserve cursor ordering and attach file metadata without loading blob content', async () => {
  let query;
  const rows = [{id: 'new', createdAt: '2026-09-24', kind: 'note'}, {id: 'old', createdAt: '2026-09-23', kind: 'note'}];
  const models = {EmailTicket: {findOne: async () => ({id: 'ticket', organizationId: 'org-a'})}, TicketMessage: {findAll: async q => {query = q; return rows.map(row => ({toJSON: () => row}));}}};
  const r = res(); await controller(models).detail(req({query: {before: '2026-09-25', beforeId: 'cursor'}}), r);
  assert.equal(r.body.data.messages[0].id, 'old'); assert.equal(query.where.organizationId, 'org-a'); assert.equal(query.limit, 100);
  assert(!query.include[1].attributes.includes('content')); assert(query.where[Op.or]);
});
