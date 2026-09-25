const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
const {randomUUID} = require('node:crypto');
function setup() {
  const requests = [], effects = [], timers = new Map(); let nextTimer = 0;
  const dependencies = {AuthService: {hasPermission: () => true, currentUser: () => ({})}, OrganizationContextService: {getActiveOrganizationId: () => 'org-a', selectedOrganizationId: () => 'org-a'}};
  dependencies.ApiService = new Proxy({}, {get: (_target, method) => (url, body) => {const stream = new rx.Subject(); requests.push({method, url, body, stream}); return stream;}});
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/debts-page/debts-page.component.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(source, {module, exports: module.exports, Date, Intl, URLSearchParams, crypto: {randomUUID}, setTimeout: fn => {timers.set(++nextTimer, fn); return nextTimer;}, clearTimeout: id => timers.delete(id), require(name) {
    if (name === 'rxjs') return rx;
    if (name === '@angular/core') return {Component: () => value => value, inject: key => dependencies[key], effect: fn => effects.push(fn)};
    return new Proxy({}, {get: (_target, key) => key});
  }});
  const page = new module.exports.DebtsPageComponent();
  const debt = {id: 'debt', title: 'Loan', creditor: 'Bank', originalAmount: '100.00', paidAmount: '0.00', remainingAmount: '100.00', currency: 'PHP', borrowedOn: '2026-01-01', status: 'outstanding'};
  return {page, debt, requests, dependencies, effects, flush: () => {const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());}};
}
test('payment preview uses exact cents and blocks zero, overpayment and invalid dates', () => {
  const {page, debt} = setup(); page.selected = debt;
  page.payment.amount = '35.10'; assert.equal(page.paymentRemaining, '64.90'); assert.equal(page.validPayment, true);
  for (const amount of ['0', '-1', '100.01', '1.234', '']) {page.payment.amount = amount; assert.equal(page.validPayment, false);}
  page.payment.amount = '100.00'; assert.equal(page.paymentRemaining, '0.00');
  page.payment.paidOn = '2025-12-31'; assert.equal(page.validPayment, false);
});
test('recording a payment updates the selected balance and refreshes history and list', () => {
  const {page, debt, requests} = setup(); page.selected = debt; page.payment.amount = '25.00'; page.recordPayment(); page.recordPayment();
  assert.equal(requests.length, 1); assert.match(requests[0].url, /\/debt\/payments\?organizationId=org-a/);
  requests[0].stream.next({data: {debt: {...debt, paidAmount: '25.00', remainingAmount: '75.00'}, payment: {id: 'payment'}}});
  assert.equal(page.selected.remainingAmount, '75.00'); assert.equal(page.payment.amount, ''); assert.equal(page.saving, false);
  assert.equal(requests.length, 3); assert.match(requests[1].url, /\/debt\?/); assert.match(requests[2].url, /\/debts\?/);
});
test('failed payment preserves the form and request key for safe retries', () => {
  const {page, debt, requests} = setup(); page.selected = debt; page.payment.amount = '25.00'; page.payment.reference = 'Receipt 123'; page.recordPayment();
  const key = requests[0].body.requestKey; requests[0].stream.error({status: 0});
  assert.equal(page.payment.amount, '25.00'); assert.equal(page.payment.reference, 'Receipt 123'); assert.equal(page.selected.remainingAmount, '100.00');
  page.recordPayment(); assert.equal(requests[1].body.requestKey, key);
});
test('debt creation validates inputs, scopes the request and prevents double clicks', () => {
  const {page, requests, debt} = setup(); page.openCreate(); page.draft.title = 'Loan'; page.draft.creditor = 'Bank'; page.draft.amount = '100.00';
  page.create(); page.create(); assert.equal(requests.length, 1); assert.match(requests[0].url, /organizationId=org-a/);
  requests[0].stream.next({data: debt}); assert.equal(page.createOpen, false); assert.equal(page.selected.id, 'debt'); assert.equal(page.notice, 'Debt added.');
});
test('search cancels old requests and sends one search after typing pauses', () => {
  const {page, requests, flush} = setup(); page.load(); page.search = 'Bank'; page.onSearchChange(); page.search = 'Bank loan'; page.onSearchChange();
  assert.equal(requests[0].stream.observers.length, 0); assert.equal(requests.length, 1); flush(); assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url, 'http://test').searchParams.get('q'), 'Bank loan');
});
test('history pagination is independent; organization changes cancel requests and discard drafts', () => {
  const {page, debt, requests, effects} = setup(); page.open(debt);
  requests[0].stream.next({data: {debt, payments: []}, meta: {total: 30, totalPages: 2}}); page.changePaymentPage(1);
  assert.equal(new URL(requests[1].url, 'http://test').searchParams.get('page'), '2');
  page.payment.amount = '99.00'; effects[0](); assert.equal(page.selected, null); assert.equal(page.payment.amount, ''); assert.equal(requests[1].stream.observers.length, 0);
});
test('read-only users cannot create debts or record payments', () => {
  const {page, debt, requests, dependencies} = setup(); dependencies.AuthService.hasPermission = permission => permission === 'debts.read';
  page.openCreate(); assert.equal(page.createOpen, false); page.selected = debt; page.payment.amount = '25.00'; page.recordPayment(); assert.equal(requests.length, 0);
});
