const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject, of, throwError } = require('rxjs');
const filename = path.join(__dirname, '../src/app/pages/expenses-page/expenses-page.component.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
}).outputText;
const loaded = { exports: {} };
vm.runInThisContext(`(function(require, module, exports) { ${source}\n})`, { filename })(name => {
  if (name.startsWith('rxjs')) return require(name);
  if (name === '@angular/core') return { Component: () => target => target };
  return {};
}, loaded, loaded.exports);
const signal = initial => { let value = initial; const get = () => value; get.set = next => { value = next; }; return get; };
const ready = (org = 'target', token = 'reviewed') => ({ targetOrganizationId: org, currency: 'PHP', taxType: { name: 'VAT' }, withholdingTaxTypes: [], withholdingTaxTypeId: 'target-ewt', requiresWithholdingSelection: false, requiresReceiptVat: false, receiptVatEditable: false, receiptVatAmount: 1200, ready: true, previewToken: token, amounts: { amount: 11200, taxAmount: 1200, receiptVatAmount: 1200, withholdingTaxBase: 10000, withHoldingTaxAmount: 200, totalAmount: 11000 } });
function fixture() {
  const page = Object.create(loaded.exports.ExpensesPageComponent.prototype);
  Object.defineProperty(page, 'isContextLocked', { value: false });
  Object.assign(page, {
    transferRow: { id: 'expense', organizationId: 'source' }, selectedTransferOrganizationId: 'target',
    selectedTransferWithholdingId: '__auto__', transferReceiptVat: null,
    confirmDialog: { confirm: async () => true }, load() {}, formatMoney: value => `PHP ${value}`,
    api: { get: () => of({ data: ready() }), create: () => of({ message: 'Transferred' }) },
  });
  for (const name of ['loadingTransferTargets', 'loadingTransferPreview']) page[name] = signal(false);
  for (const name of ['transferringId', 'transferModalError', 'message', 'error']) page[name] = signal('');
  page.isTransferModalOpen = signal(true); page.transferPreview = signal(null);
  page.transferTargetOrganizations = signal([{ id: 'target', name: 'Target' }]);
  return page;
}
test('changing target cancels the earlier calculation and prevents stale totals from being shown', () => {
  const page = fixture(); const old = new Subject(); const latest = new Subject();
  page.api.get = url => url.includes('targetOrganizationId=target') ? old : latest;
  page.onTransferOrganizationChange(); assert.equal(page.loadingTransferPreview(), true); assert.equal(page.canTransferExpense, false);
  page.selectedTransferOrganizationId = 'new'; page.onTransferOrganizationChange();
  assert.equal(old.observers.length, 0); old.next({ data: ready() });
  latest.next({ data: ready('new') }); assert.equal(page.transferPreview().targetOrganizationId, 'new'); assert.equal(page.canTransferExpense, true);
});
test('target loading is cancelled when reopening or closing the dialog', () => {
  const page = fixture(); const requests = []; page.api.get = () => { const request = new Subject(); requests.push(request); return request; };
  page.openTransferModal({ id: 'first', organizationId: 'source' });
  page.openTransferModal({ id: 'second', organizationId: 'source' }); assert.equal(requests[0].observers.length, 0);
  page.closeTransferModal(); assert.equal(requests[1].observers.length, 0);
  requests[1].next({ data: [{ id: 'target' }] }); assert.equal(page.transferPreview(), null); assert.equal(page.isTransferModalOpen(), false);
});
test('automatically selected sole organization still requires a completed tax preview', () => {
  const page = fixture(); const preview = new Subject();
  page.api.get = url => url.includes('transfer-targets') ? of({ data: [{ id: 'target' }] }) : preview;
  page.openTransferModal({ id: 'expense', organizationId: 'source' }); assert.equal(page.canTransferExpense, false);
  preview.next({ data: ready() }); assert.equal(page.canTransferExpense, true);
});
test('failed preview disables transfer and retry reloads authoritative amounts', async () => {
  const page = fixture(); page.transferPreview.set(ready());
  page.api.get = () => throwError(() => ({ error: { message: 'Invalid supplier VAT' } }));
  page.loadTransferPreview(); assert.equal(page.canTransferExpense, false); assert.equal(page.transferPreview().previewToken, null);
  let posted = false; page.api.create = () => { posted = true; return of({}); }; await page.transferExpense(); assert.equal(posted, false);
  page.api.get = () => of({ data: ready() }); page.loadTransferPreview(); assert.equal(page.canTransferExpense, true);
});
test('missing withholding mapping blocks submit until an explicit None or destination type is selected', () => {
  const page = fixture(); page.api.get = () => of({ data: { ...ready(), ready: false, previewToken: null, requiresWithholdingSelection: true, amounts: null } });
  page.loadTransferPreview(); assert.equal(page.canTransferExpense, false); assert.equal(page.selectedTransferWithholdingId, '__auto__');
  page.selectedTransferWithholdingId = ''; page.transferReceiptVat = 0;
  page.api.get = url => { assert.match(url, /withholdingTaxTypeId=&receiptVatAmount=0/); return of({ data: { ...ready(), withholdingTaxTypeId: null } }); };
  page.loadTransferPreview(); assert.equal(page.canTransferExpense, true);
});
test('submit sends exactly the reviewed tax selection and token; double clicks cannot post twice', async () => {
  const page = fixture(); page.transferPreview.set(ready()); let resolve; let posts = 0;
  page.confirmDialog.confirm = () => new Promise(done => { resolve = done; });
  page.api.create = (url, payload) => { posts++; assert.equal(url, '/api/v1/expenses/expense/transfer'); assert.deepEqual(payload, { targetOrganizationId: 'target', withholdingTaxTypeId: 'target-ewt', receiptVatAmount: 1200, previewToken: 'reviewed' }); return of({}); };
  const first = page.transferExpense(); await page.transferExpense(); assert.equal(posts, 0); assert.equal(page.canTransferExpense, false);
  resolve(true); await first; assert.equal(posts, 1); assert.equal(page.isTransferModalOpen(), false);
});
test('confirmation cancellation restores the reviewed state without sending a write', async () => {
  const page = fixture(); page.transferPreview.set(ready()); page.confirmDialog.confirm = async () => false;
  page.api.create = () => { throw new Error('must not post'); }; await page.transferExpense(); assert.equal(page.transferringId(), ''); assert.equal(page.canTransferExpense, true);
});
test('changes while confirmation is pending cannot submit obsolete reviewed data', async () => {
  const page = fixture(); page.transferPreview.set(ready()); let resolve;
  page.confirmDialog.confirm = () => new Promise(done => { resolve = done; }); page.api.create = () => { throw new Error('must not post'); };
  const pending = page.transferExpense(); page.transferPreview.set(ready('new', 'new-token')); resolve(true); await pending;
  assert.equal(page.transferringId(), '');
});
test('server conflict consumes the old preview and requires a fresh review', async () => {
  const page = fixture(); page.transferPreview.set(ready()); page.api.create = () => throwError(() => ({ status: 409, error: { message: 'Settings changed' } }));
  await page.transferExpense(); assert.equal(page.canTransferExpense, false); assert.equal(page.transferPreview().previewToken, null); assert.equal(page.transferModalError(), 'Settings changed');
});
test('destroy unsubscribes from in-flight preview and target requests', () => {
  const page = fixture(); const request = new Subject(); page.api.get = () => request;
  page.loadTransferPreview(); page.ngOnDestroy(); assert.equal(request.observers.length, 0);
});
