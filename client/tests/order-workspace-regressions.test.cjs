const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
function setup(permissions = ['orders.create', 'orders.update']) {
  const requests = [], navigations = [], params = new rx.Subject();
  const api = Object.fromEntries(['create', 'put', 'createFormData', 'putFormData', 'getFresh', 'get', 'list'].map(method => [method, (url, body) => {
    const stream = new rx.Subject(); requests.push({ method, url, body, stream }); return stream;
  }]));
  const deps = { ApiService: api, ActivatedRoute: { snapshot: { paramMap: { get: () => null } }, paramMap: params }, Router: { navigate: (...args) => navigations.push(args) }, AuthService: { hasPermission: code => permissions.includes(code) }, OrganizationContextService: { getActiveOrganizationId: () => 'org-a' }, ConfirmDialogService: { confirm: async () => false } };
  const taxModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/core/expense-calculation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: taxModule, exports: taxModule.exports });
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/order-workspace-page/order-workspace-page.component.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, FormData, crypto: require('node:crypto').webcrypto, console, require(name) {
    if (name === 'rxjs') return { ...rx, forkJoin: sources => rx.forkJoin({ ...sources }) };
    if (name.endsWith('/expense-calculation')) return taxModule.exports;
    if (name === '@angular/core') return { Component: () => value => value, HostListener: () => () => {}, ViewChild: () => () => {}, effect: () => {}, inject: key => deps[key] };
    return new Proxy({}, { get: (_, key) => key });
  } });
  const page = new module.exports.OrderWorkspacePageComponent(); page.org = 'org-a';
  page.lines = [{ name: 'Service', quantity: 1, unitPrice: 100, itemId: null, type: 'service', unit: 'each' }];
  const order = { id: 'order-a', revision: 1, organizationId: 'org-a', status: 'draft', currency: 'PHP', orderedItemSnapshots: page.lines, workflow: { po: { status: 'unverified' }, poRequired: false }, documents: [], salesInvoices: [] };
  return { page, requests, navigations, order, params };
}
test('loading an existing order with JSON text uses its organization and does not stop halfway through hydration', () => {
  const e = setup(); e.page.org = ''; e.page.routeId = 'order-a'; e.page.load();
  e.requests[0].stream.next({ data: { ...e.order, workflow: JSON.stringify({ po: {}, fulfilled: {}, payments: [] }) } });
  assert.equal(e.page.loading, false); assert.equal(e.page.hasOrganization, true); assert.equal(e.page.orderOrganizationId, 'org-a'); assert.equal(e.page.error, '');
  assert.equal(e.requests.length, 5); assert.ok(e.requests.slice(1).every(r => r.url.includes('organizationId=org-a')));
});
test('legacy or incomplete PO data does not hide the organization', () => {
  const e = setup(); for (const workflow of [null, { fulfilled: {}, payments: [] }]) { e.page.org = ''; e.page.accept({ ...e.order, workflow }); assert.equal(e.page.hasOrganization, true); assert.equal(e.page.customerPoDate, ''); }
});
test('stale order responses cannot replace a more recently selected order', () => {
  const e = setup(); e.page.routeId = 'old'; e.page.load(); e.page.routeId = 'new'; e.page.load();
  e.requests[1].stream.next({ data: { ...e.order, id: 'new', organizationId: 'org-b' } });
  e.requests[0].stream.next({ data: { ...e.order, id: 'old' } }); assert.equal(e.page.order.id, 'new'); assert.equal(e.page.orderOrganizationId, 'org-b');
});
test('a failed lookup does not discard valid withholding rates or the order', () => {
  const e = setup(); e.page.accept(e.order); e.page.loadLookups();
  const tax = e.requests.find(r => r.url.includes('withholding-tax-types')); assert.ok(tax.url.includes('activeOnly=true')); assert.ok(!tax.url.includes('appliesTo='));
  for (const r of e.requests) {
    if (r.url.includes('/customers?')) r.stream.error({ status: 403 });
    else { r.stream.next({ data: r === tax ? [{ id: 'tax', name: 'Managed rate', percentage: 2, appliesTo: 'expense' }] : r.url.includes('workflow-settings') ? { settings: e.page.config, presets: {}, currency: 'PHP', taxType: { code: 'VAT', percentage: 12 } } : [] }); r.stream.complete(); }
  }
  assert.equal(e.page.taxes.length, 1); assert.equal(e.page.taxes[0].appliesTo, 'expense'); assert.equal(e.page.order.id, e.order.id); assert.equal(e.page.lookupsLoading, false); assert.match(e.page.lookupErrors[0], /customers/);
});
test('selected withholding appears in the editable estimate and is sent to the API', () => {
  const e = setup(); e.page.organizationTaxType = { code: 'VAT', percentage: 12 }; e.page.lines[0].unitPrice = 112;
  e.page.taxes = [{ id: 'tax', name: '2%', percentage: 2 }]; e.page.withholdingTaxTypeId = 'tax';
  assert.equal(e.page.estimatedTax, 12); assert.equal(e.page.estimatedWithholding, 2); assert.equal(e.page.estimate, 110);
  e.page.save(); assert.equal(e.requests[0].body.withholdingTaxTypeId, 'tax');
});
test('fulfillment validates remaining quantities and records fractional amounts with the current revision', () => {
  const e = setup(); const line = { ...e.page.lines[0], id: 'line', quantity: 1.125 };
  const order = { ...e.order, status: 'confirmed', orderedItemSnapshots: [line], workflow: { po: {}, fulfilled: { line: 0.125 } }, fulfillmentStatus: 'partially_fulfilled' };
  e.page.accept(order); e.page.openAction('fulfill'); assert.match(e.page.error, /Enter a quantity/); assert.equal(e.page.actionModal, '');
  e.page.fulfillment.line = 1.001; e.page.openAction('fulfill'); assert.match(e.page.error, /Only 1/);
  e.page.fillRemaining(); assert.equal(e.page.fulfillment.line, 1); e.page.openAction('fulfill'); assert.equal(e.page.actionModal, 'fulfill');
  e.page.runAction('fulfill'); assert.equal(e.requests[0].body.action, 'fulfill'); assert.equal(e.requests[0].body.revision, 1); assert.equal(e.requests[0].body.lines[0].quantity, 1);
  e.requests[0].stream.next({ data: { ...order, revision: 2, fulfillmentStatus: 'fulfilled', workflow: { po: {}, fulfilled: { line: 1.125 } } } });
  assert.equal(e.page.remaining(line), 0); assert.equal(e.page.fulfillment.line, 0); assert.match(e.page.success, /Fulfillment recorded/);
});
test('failed fulfillment preserves entered quantities for correction or retry', () => {
  const e = setup(); e.page.accept({ ...e.order, status: 'confirmed', orderedItemSnapshots: [{ ...e.page.lines[0], id: 'line' }], workflow: { po: {}, fulfilled: {} } });
  e.page.fulfillment.line = 0.5; e.page.openAction('fulfill'); e.page.runAction('fulfill'); e.requests[0].stream.error({ error: { message: 'Reload this order' } }); assert.equal(e.page.fulfillment.line, 0.5); assert.equal(e.page.actionModal, 'fulfill'); assert.equal(e.page.busy, false);
});
