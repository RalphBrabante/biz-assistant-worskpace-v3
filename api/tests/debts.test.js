const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {cents, money, positive} = require('../src/services/debt-amounts');
function load(models) {
  const filename = path.resolve(__dirname, '../src/controllers/debts-controller.js'), real = createRequire(filename), module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {module, exports: module.exports, console: {error() {}}, Date, require: name => name === '../sequelize' ? {getModels: () => models} : real(name)});
  return module.exports;
}
const key = '11111111-1111-4111-8111-111111111111';
const anotherKey = '22222222-2222-4222-8222-222222222222';
function request(body = {}, extras = {}) {return {query: {}, params: {id: 'debt'}, auth: {userId: 'user', user: {organizationId: 'org-a'}, roleCodes: ['staff']}, body, ...extras};}
function response() {return {statusCode: 200, headers: {}, set(k,v) {this.headers[k] = v; return this;}, status(code) {this.statusCode = code; return this;}, json(body) {this.body = body; return this;}};}
const payment = (amount = '25.00', requestKey = key) => ({amount, paidOn: '2026-09-26', reference: 'Bank transfer', notes: '', requestKey});
function fixture() {
  const debts = [], payments = [], queries = []; let failUpdate = false, tail = Promise.resolve();
  function wrap(row) {
    row.toJSON = () => Object.fromEntries(Object.entries(row).filter(([,v]) => typeof v !== 'function'));
    row.update = async values => {if (failUpdate) throw new Error('database update failed'); Object.assign(row, values);}; return row;
  }
  const debt = wrap({id: 'debt', organizationId: 'org-a', title: 'Equipment', creditor: 'Lender', originalAmount: '100.00', paidAmount: '0.00', currency: 'PHP', borrowedOn: '2026-09-01', notes: '', dueOn: null}); debts.push(debt);
  const match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const database = {transaction(fn) {
    const operation = tail.then(async () => {
      const snapshot = debts.map(row => row.toJSON()), count = payments.length;
      const transaction = {LOCK: {UPDATE: 'UPDATE'}};
      try {return await fn(transaction);} catch (error) {
        payments.splice(count); debts.splice(snapshot.length); snapshot.forEach((values,i) => Object.assign(debts[i], values)); throw error;
      }
    });
    tail = operation.catch(() => {}); return operation;
  }};
  const models = {
    Organization: {findByPk: async (id) => id === 'org-a' ? {id, currency: 'PHP'} : null},
    Debt: {sequelize: database, findOne: async q => {queries.push(q); return debts.find(row => match(row, q.where)) || null;}, create: async values => {const row = wrap({id: `debt-${debts.length}`, ...values}); debts.push(row); return row;}},
    DebtPayment: {
      findOne: async q => payments.find(row => match(row, q.where)) || null,
      create: async (values, options) => {assert(options.transaction); const row = {id: `payment-${payments.length}`, ...values}; payments.push(row); return row;},
      findAndCountAll: async q => {queries.push(q); const matching = payments.filter(row => match(row, q.where)); return {rows: matching.slice(q.offset, q.offset + q.limit), count: matching.length};},
    },
  };
  return {c: load(models), models, debt, debts, payments, queries, setFailUpdate: value => failUpdate = value};
}
test('currency arithmetic is exact and rejects negative, excessive precision and nonnumeric input', () => {
  assert.equal(money(cents('0.10') + cents('0.20')), '0.30');
  assert.equal(positive('999999999999.99', 'Debt amount'), '999999999999.99');
  for (const value of ['0', '-1', '1.001', 'NaN', 'Infinity', '1e3', null, '', '1000000000000.00']) assert.throws(() => positive(value, 'Amount'));
});
test('partial and full repayments reduce the debt exactly and retain separate history', async () => {
  const e = fixture();
  let r = response(); await e.c.pay(request(payment('35.10')), r);
  assert.equal(r.statusCode, 201); assert.equal(r.body.data.debt.remainingAmount, '64.90'); assert.equal(r.body.data.debt.status, 'outstanding');
  r = response(); await e.c.pay(request(payment('64.90', anotherKey)), r);
  assert.equal(e.debt.paidAmount, '100.00'); assert.equal(r.body.data.debt.remainingAmount, '0.00'); assert.equal(r.body.data.debt.status, 'paid'); assert.equal(e.payments.length, 2);
  assert(e.queries.filter(q => q.transaction).every(q => q.lock === 'UPDATE'));
});
test('overpayments and concurrent payments cannot make a debt negative', async () => {
  const e = fixture(), first = response(), second = response();
  await Promise.all([e.c.pay(request(payment('70.00')), first), e.c.pay(request(payment('50.00', anotherKey)), second)]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]); assert.equal(e.payments.length, 1); assert.equal(e.debt.paidAmount, '70.00');
  const r = response(); await e.c.pay(request(payment('100.00', anotherKey)), r); assert.equal(r.statusCode, 409); assert.equal(e.payments.length, 1);
});
test('retrying the same payment key does not reduce the balance twice; changed payload conflicts', async () => {
  const e = fixture(), a = response(), b = response();
  await Promise.all([e.c.pay(request(payment()), a), e.c.pay(request(payment()), b)]);
  assert.equal(e.payments.length, 1); assert.equal(e.debt.paidAmount, '25.00'); assert.equal(b.statusCode, 200);
  const changed = response(); await e.c.pay(request(payment('30.00')), changed); assert.equal(changed.statusCode, 409); assert.equal(e.payments.length, 1);
});
test('failed balance update rolls back the payment record', async () => {
  const e = fixture(); e.setFailUpdate(true); const r = response(); await e.c.pay(request(payment()), r);
  assert.equal(r.statusCode, 500); assert.equal(e.payments.length, 0); assert.equal(e.debt.paidAmount, '0.00');
  e.setFailUpdate(false); await e.c.pay(request(payment()), response()); assert.equal(e.payments.length, 1);
});
test('organization scoping protects history, payment writes and aggregate queries', async () => {
  const e = fixture();
  for (const action of ['detail', 'pay']) {
    const r = response(); await e.c[action](request(payment(), {auth: {userId: 'foreign', roleCodes: ['administrator'], user: {organizationId: 'org-b'}}, query: {organizationId: 'org-a'}}), r);
    assert.equal(r.statusCode, 404);
  }
  assert.equal(e.payments.length, 0);
  assert.throws(() => e.c.scope(request({}, {auth: {roleCodes: ['superuser']}})), /Select an organization/);
  let aggregate;
  e.models.Debt.findAndCountAll = async q => {assert.equal(q.where.organizationId, 'org-a'); return {rows: [e.debt], count: 1};};
  e.models.Debt.findAll = async q => {aggregate = q; return [{currency: 'PHP', originalAmount: '100.00', paidAmount: '0.00', remainingAmount: '100.00'}];};
  const r = response(); await e.c.list(request({}, {query: {organizationId: 'org-b', status: 'outstanding', q: 'Equipment'}}), r);
  assert.equal(r.statusCode, 200); assert.equal(aggregate.where.organizationId, 'org-a'); assert.equal(r.body.data.debts[0].remainingAmount, '100.00'); assert.equal(r.headers['Cache-Control'], 'private, no-store');
});
test('debt creation validates dates and amounts, takes currency from the organization, and is retry-safe', async () => {
  const e = fixture(); const body = {title: 'Loan', creditor: 'Bank', amount: '123.45', borrowedOn: '2026-09-01', dueOn: '2026-10-01', requestKey: key, currency: 'USD', paidAmount: '123.45', organizationId: 'foreign'};
  const r = response(); await e.c.create(request(body), r);
  assert.equal(r.statusCode, 201); assert.equal(r.body.data.currency, 'PHP'); assert.equal(r.body.data.remainingAmount, '123.45'); assert.equal(r.body.data.organizationId, 'org-a');
  const repeated = response(); await e.c.create(request(body), repeated); assert.equal(repeated.statusCode, 200); assert.equal(e.debts.length, 2);
  for (const change of [{amount: '-1'}, {borrowedOn: '2026-02-30'}, {dueOn: '2026-08-01'}, {requestKey: 'invalid'}, {creditor: ''}]) {
    const invalid = response(); await e.c.create(request({...body, ...change}), invalid); assert.equal(invalid.statusCode, 400);
  }
});
test('payment validation rejects invalid dates, pre-debt dates, zero and malformed request keys', async () => {
  const e = fixture();
  for (const change of [{paidOn: '2026-02-30'}, {paidOn: '2026-08-01'}, {amount: '0'}, {amount: '1.999'}, {requestKey: 'invalid'}]) {
    const r = response(); await e.c.pay(request({...payment(), ...change}), r); assert.equal(r.statusCode, 400);
  }
  assert.equal(e.payments.length, 0);
});
test('payment history is paginated and uses the same transaction as its balance', async () => {
  const e = fixture(); for (let i = 0; i < 23; i++) e.payments.push({debtId: 'debt', organizationId: 'org-a', amount: '1.00'});
  e.debt.paidAmount = '23.00'; const r = response(); await e.c.detail(request({}, {query: {page: '2'}}), r);
  assert.equal(r.body.data.payments.length, 3); assert.equal(r.body.data.debt.remainingAmount, '77.00'); assert.equal(r.body.meta.totalPages, 2);
  assert.equal(e.queries[0].transaction, e.queries[1].transaction);
});
