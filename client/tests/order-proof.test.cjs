const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
function setup(permissions = ['orders.create', 'orders.update']) {
  const requests = [], navigations = [], params = new rx.Subject();
  const api = Object.fromEntries(['create', 'put', 'createFormData', 'putFormData', 'getFresh'].map(method => [method, (url, body) => {
    const stream = new rx.Subject(); requests.push({ method, url, body, stream }); return stream;
  }]));
  const deps = { ApiService: api, ActivatedRoute: { snapshot: { paramMap: { get: () => null } }, paramMap: params }, Router: { navigate: (...args) => navigations.push(args) }, AuthService: { hasPermission: code => permissions.includes(code) }, OrganizationContextService: { getActiveOrganizationId: () => 'org-a' }, ConfirmDialogService: { confirm: async () => false } };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/order-workspace-page/order-workspace-page.component.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, FormData, crypto: require('node:crypto').webcrypto, console, require(name) {
    if (name === 'rxjs') return rx;
    if (name === '@angular/core') return { Component: () => value => value, HostListener: () => () => {}, ViewChild: () => () => {}, effect: () => {}, inject: key => deps[key] };
    return new Proxy({}, { get: (_, key) => key });
  } });
  const page = new module.exports.OrderWorkspacePageComponent(); page.org = 'org-a';
  page.lines = [{ name: 'Service', quantity: 1, unitPrice: 100, itemId: null, type: 'service', unit: 'each' }];
  const order = { id: 'order-a', revision: 1, organizationId: 'org-a', status: 'draft', currency: 'PHP', orderedItemSnapshots: page.lines, workflow: { po: { status: 'unverified' }, poRequired: false }, documents: [], salesInvoices: [] };
  return { page, requests, navigations, order, params };
}
test('new orders attach uploaded IDs in one save without enabling PO requirements', () => {
  const e = setup(); let saved = false; e.page.proofUploader = { markSaved: () => { saved = true; } };
  e.page.proofUploads = [{ id: 'upload-a', status: 'uploaded' }, { id: 'upload-b', status: 'uploaded' }];
  e.page.save(); const r = e.requests[0]; assert.equal(r.method, 'create'); assert.equal(r.body.uploadIds.join(','), 'upload-a,upload-b'); assert.equal(r.body.poRequired, false);
  r.stream.next({ data: e.order }); assert.equal(saved, true); assert.equal(e.page.proofUploads.length, 0); assert.equal(e.page.hasUnsavedChanges, false); assert.equal(e.navigations.length, 1);
});
test('saving without proof keeps attachments optional', () => {
  const e = setup(); e.page.save(); assert.equal(e.requests[0].body.uploadIds.length, 0); assert.equal(e.requests[0].body.poRequired, false);
});
test('incomplete or failed uploads block saving; uploaded files remain available after a failed save', () => {
  const e = setup(); e.page.accept(e.order);
  for (const status of ['queued', 'uploading', 'processing', 'error']) { e.page.proofUploads = [{ id: 'upload-a', status }]; e.page.save(); assert.equal(e.requests.length, 0); }
  e.page.proofUploads = [{ id: 'upload-a', status: 'uploaded' }]; e.page.save();
  const r = e.requests[0]; assert.equal(r.method, 'put'); assert.equal(r.body.revision, 1);
  r.stream.error({ status: 503 }); assert.equal(e.page.proofUploads[0].id, 'upload-a'); assert.equal(e.page.busy, false); e.page.save(); assert.equal(e.requests[1].body.uploadIds[0], 'upload-a');
});
test('unsaved uploads block confirmation and survive cancelled reload', async () => {
  const e = setup(); e.page.accept(e.order); e.page.proofUploads = [{ id: 'upload-a', status: 'uploaded' }];
  e.page.openAction('confirm'); e.page.runAction('confirm'); assert.equal(e.requests.length, 0); assert.equal(e.page.actionModal, '');
  await e.page.reload(); assert.equal(e.page.proofUploads.length, 1);
});
test('read-only and confirmed orders cannot save new proof', () => {
  const e = setup([]); e.page.accept(e.order); e.page.save(); assert.equal(e.requests.length, 0);
  const confirmed = setup(); confirmed.page.accept({ ...confirmed.order, status: 'confirmed' }); confirmed.page.save(); assert.equal(confirmed.requests.length, 0);
});
