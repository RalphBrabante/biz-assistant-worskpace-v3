const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
const {randomUUID} = require('node:crypto');
function setup() {
  const requests = [], revoked = [], effects = [];
  const api = new Proxy({}, {get: (_target, method) => (url, body) => {
    const stream = new rx.Subject(); requests.push({method, url, body, stream}); return stream;
  }});
  const dependencies = {ApiService: api, AuthService: {hasPermission: () => true, currentUser: () => ({})}, OrganizationContextService: {getActiveOrganizationId: () => 'org-a', selectedOrganizationId: () => 'org-a'}};
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/tickets-page/tickets-page.component.ts'), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true},
  }).outputText;
  const module = {exports: {}};
  vm.runInNewContext(source, {module, exports: module.exports, URLSearchParams, FormData, Blob, crypto: {randomUUID}, Date, setTimeout,
    URL: {createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url)}, document: {getElementById: () => ({focus() {}})},
    require(name) {
      if (name === 'rxjs') return rx;
      if (name === '@angular/core') return {Component: () => value => value, inject: key => dependencies[key], effect: fn => effects.push(fn)};
      return new Proxy({}, {get: (_target, key) => key});
    },
  });
  const page = new module.exports.TicketsPageComponent();
  page.options.mailbox = {email: 'support@example.com', connected: true};
  const incoming = {id: 'inbound', kind: 'inbound', sender: 'client@example.com', createdAt: '2026-09-24T00:00:00Z', envelope: {to: ['support@example.com'], cc: ['cc@example.com']}, replyRecipients: {to: ['client@example.com'], cc: []}, replyAllRecipients: {to: ['client@example.com'], cc: ['cc@example.com']}};
  const ticket = {id: 'ticket', mailboxId: 'mailbox', version: 3, status: 'open', priority: 2};
  page.selected = ticket; page.messages = [incoming]; page.replyTargetId = incoming.id;
  return {page, requests, incoming, ticket, revoked, effects, dependencies};
}
test('reply-all displays server-resolved recipients and submits target, files and an idempotency key', () => {
  const {page, requests, incoming} = setup();
  page.replyTo(incoming, 'replyAll'); assert.deepEqual(page.recipients.cc, ['cc@example.com']);
  page.compose = 'Here is the document';
  const file = new Blob(['attachment'], {type: 'text/plain'}); file.name = 'document.txt'; page.files = [file];
  page.submitMessage(); page.submitMessage();
  assert.equal(requests.length, 1); const request = requests[0];
  assert.equal(request.method, 'createFormData'); assert.match(request.url, /organizationId=org-a/);
  assert.equal(request.body.get('replyToMessageId'), 'inbound'); assert.equal(request.body.get('mode'), 'replyAll');
  assert.equal(request.body.get('version'), '3'); assert.equal(request.body.getAll('attachments').length, 1);
  request.stream.next({data: {deliveryStatus: 'sent'}});
  assert.equal(page.compose, ''); assert.equal(page.files.length, 0); assert.equal(page.saving, false);
});
test('unknown delivery preserves draft and request key and checking it cannot issue a new send intent', () => {
  const {page, requests, incoming} = setup(); page.replyTo(incoming, 'reply'); page.compose = 'Keep this draft'; page.submitMessage();
  const key = requests[0].body.get('requestKey');
  requests[0].stream.error({status: 0}); assert.equal(page.deliveryUncertain, true); assert.equal(page.compose, 'Keep this draft');
  page.replyTo({...incoming, id: 'other'}, 'replyAll'); assert.equal(page.replyTargetId, 'inbound');
  page.submitMessage(); assert.equal(requests[1].body.get('requestKey'), key);
  requests[1].stream.next({data: {deliveryStatus: 'unknown'}, message: 'Check Sent'});
  assert.equal(page.compose, 'Keep this draft'); assert.equal(page.deliveryUncertain, true);
});
test('private notes never submit email attachments and reply permission is checked', () => {
  const {page, requests, dependencies} = setup(); page.compose = 'Internal only'; page.files = [new Blob(['private'])];
  page.submitMessage(); assert.equal(requests[0].method, 'create'); assert.match(requests[0].url, /notes\?/); assert.equal(requests[0].body.body, 'Internal only'); assert.equal(requests[0].body.attachments, undefined);
  page.saving = false; page.composeMode = 'reply'; dependencies.AuthService.hasPermission = () => false;
  page.submitMessage(); assert.equal(requests.length, 1);
});
test('history loads earlier pages, suppresses stale detail responses and can hide activity', () => {
  const {page, requests, incoming, ticket} = setup(); page.fetchDetail(true);
  const params = new URL(requests[0].url, 'http://test').searchParams;
  assert.equal(params.get('beforeId'), incoming.id); assert.equal(params.get('before'), incoming.createdAt);
  requests[0].stream.next({data: {ticket, messages: [{id: 'older', kind: 'activity'}], hasMore: false}});
  assert.equal(page.messages[0].id, 'older'); assert.equal(page.messages[1].id, 'inbound');
  page.showActivity = false; assert.equal(page.visibleMessages.length, 1);
  page.fetchDetail(); page.close(); requests[1].stream.next({data: {ticket, messages: [incoming]}});
  assert.equal(page.selected, null);
});
test('attachment previews use authenticated API requests and revoke object URLs on close', () => {
  const {page, requests, incoming, revoked} = setup();
  const file = {id: 'file', filename: 'photo.png', size: 2, contentType: 'image/png'};
  page.downloadAttachment(incoming, file, true);
  assert.match(requests[0].url, /tickets\/ticket\/messages\/inbound\/attachments\/file\?organizationId=org-a/);
  requests[0].stream.next(new Blob(['png'])); assert.equal(page.previewUrl, 'blob:preview');
  page.close(); assert.deepEqual(revoked, ['blob:preview']);
  assert.equal(page.canPreview({...file, contentType: 'image/svg+xml'}), false);
});
test('file limits retain existing attachments and organization changes clear private drafts', () => {
  const {page, effects} = setup();
  const event = {target: {files: [{name: 'large.bin', size: 11 * 1024 * 1024}], value: 'large.bin'}};
  page.addFiles(event); assert.equal(page.files.length, 0); assert.match(page.detailError, /10 MB/);
  page.compose = 'Private'; page.files = [new Blob(['draft'])]; effects[0]();
  assert.equal(page.compose, ''); assert.equal(page.files.length, 0); assert.equal(page.selected, null);
});
