const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), rx = require('rxjs');

async function setup({ superuser = true, canDelete = true } = {}) {
  await import('@angular/compiler');
  const forms = await import('@angular/forms'), requests = [], confirmations = [];
  let confirm = async () => true, reloads = 0;
  const signal = initial => { let value = initial; const read = () => value; read.set = next => { value = next; }; return read; };
  const deps = { organization: { isSuperuser: () => superuser }, fb: new forms.FormBuilder(),
    dialog: { confirm: options => { confirmations.push(options); return confirm(); } } };
  const mocks = {
    '@angular/core': { Component: () => value => value, inject: key => deps[key], signal, computed: fn => fn },
    '@angular/common': {}, '@angular/forms': { ...forms, FormBuilder: 'fb' }, '@angular/router': {}, rxjs: rx,
    '../../core/organization-context.service': { OrganizationContextService: 'organization' },
    '../../core/confirm-dialog.service': { ConfirmDialogService: 'dialog' },
    '../../shared/countries': { getBrowserCountry: () => 'Philippines' }, '../../core/table-preferences': {},
  };
  const filename = path.join(__dirname, '../src/app/pages/users-page/users-page.component.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] || {} });
  const request = (method, url, id, payload) => { const stream = new rx.Subject(); requests.push({ method, url, id, payload, stream }); return stream; };
  const api = { update: (...args) => request('update', ...args), remove: (...args) => request('remove', ...args) };
  const page = new module.exports.UsersPageComponent(api, { hasPermission: () => canDelete });
  page.rows.set([{ id: 'target', email: 'target@example.test', isActive: true }]); page.load = () => { reloads++; };
  return { page, requests, confirmations, reloads: () => reloads, setConfirm: value => { confirm = value; } };
}

test('active or unknown account state blocks deletion without a confirmation or request', async () => {
  const f = await setup();
  for (const isActive of [true, undefined]) {
    f.page.rows.set([{ id: 'target', isActive }]); await f.page.removeUser('target');
    assert.equal(f.requests.length, 0); assert.equal(f.confirmations.length, 0); assert.match(f.page.error(), /Deactivate/);
  }
});

test('deactivation sends only the account flag, then deletion becomes available after refreshed data', async () => {
  const f = await setup(); await f.page.deactivateUser('target'); await f.page.deactivateUser('target');
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].method, 'update');
  assert.equal(f.requests[0].url, '/api/v1/users'); assert.equal(f.requests[0].payload.isActive, false);
  assert.deepEqual(Object.keys(f.requests[0].payload), ['isActive']);
  assert.equal(f.page.canDeleteUser(f.page.rows()[0]), false);
  f.requests[0].stream.next({}); assert.equal(f.reloads(), 1); assert.equal(f.page.deactivatingId(), '');
  f.page.rows.set([{ id: 'target', email: 'target@example.test', isActive: false }]);
  await f.page.removeUser('target'); await f.page.removeUser('target');
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].method, 'remove'); assert.equal(f.requests[1].id, 'target');
  f.requests[1].stream.next({}); assert.equal(f.reloads(), 2); assert.equal(f.page.deletingId(), '');
});

test('cancellation sends no mutation, and deactivation failure keeps deletion blocked and allows retry', async () => {
  const f = await setup(); f.setConfirm(async () => false); await f.page.deactivateUser('target');
  assert.equal(f.requests.length, 0);
  f.setConfirm(async () => true); await f.page.deactivateUser('target');
  f.requests[0].stream.error({ error: { message: 'Deactivation failed' } });
  assert.equal(f.page.error(), 'Deactivation failed'); assert.equal(f.page.deactivatingId(), '');
  await f.page.removeUser('target'); assert.equal(f.requests.length, 1);
  await f.page.deactivateUser('target'); assert.equal(f.requests.length, 2);
});

test('permissions and shared organization memberships restrict account actions', async () => {
  const f = await setup({ superuser: false, canDelete: false }); await f.page.deactivateUser('target');
  f.page.rows.set([{ id: 'target', isActive: false }]); await f.page.removeUser('target');
  assert.equal(f.requests.length, 0); assert.equal(f.confirmations.length, 0);
  const shared = await setup(); shared.page.rows.set([{ id: 'target', isActive: true, canManageAccount: false }]);
  await shared.page.deactivateUser('target'); shared.page.rows.set([{ id: 'target', isActive: false, canManageAccount: false }]);
  await shared.page.removeUser('target'); assert.equal(shared.requests.length, 0);
});

test('confirmation rechecks current state, cancelled deletion and failed deletion are retryable', async () => {
  const f = await setup(); f.page.rows.set([{ id: 'target', isActive: false }]);
  let approve; f.setConfirm(() => new Promise(resolve => { approve = resolve; }));
  const pending = f.page.removeUser('target'); await f.page.removeUser('target');
  assert.equal(f.confirmations.length, 1);
  f.page.rows.set([{ id: 'target', isActive: true }]); approve(true); await pending; assert.equal(f.requests.length, 0);
  f.page.rows.set([{ id: 'target', isActive: false }]); f.setConfirm(async () => false);
  await f.page.removeUser('target'); assert.equal(f.requests.length, 0);
  f.setConfirm(async () => true); await f.page.removeUser('target');
  f.requests[0].stream.error({ error: { message: 'Deactivate this user before deleting the account.' } });
  assert.match(f.page.error(), /Deactivate/); assert.equal(f.page.deletingId(), '');
  await f.page.removeUser('target'); assert.equal(f.requests.length, 2);
});
