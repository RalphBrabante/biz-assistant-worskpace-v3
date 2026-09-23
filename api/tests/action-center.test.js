const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { Op } = require('sequelize');

const filename = path.resolve(__dirname, '../src/controllers/action-center-controller.js');
const originalRequire = createRequire(filename);

function setup({ permissions = ['sales_invoices.read', 'expenses.read'], superuser = false, organizationId = 'own-org', unavailable = false, fail = false } = {}) {
  const queries = [];
  const invoices = [
    { id: 'oldest', dueDate: '2026-09-01', paymentStatus: 'partially_paid' },
    { id: 'eligible', dueDate: '2026-09-22' },
    { id: 'today', dueDate: '2026-09-23' },
    { id: 'future', dueDate: '2026-09-24' },
    { id: 'draft', status: 'draft' },
    { id: 'void', status: 'void' },
    { id: 'paid-status', status: 'paid' },
    { id: 'paid-payment', paymentStatus: 'paid' },
    { id: 'refunded', paymentStatus: 'refunded' },
    { id: 'paid-date', paidAt: '2026-09-20' },
    { id: 'no-date', dueDate: null },
    { id: 'other-org', organizationId: 'other-org' },
  ].map(row => ({ organizationId: 'own-org', status: 'issued', paymentStatus: 'unpaid', paidAt: null, dueDate: '2026-09-20', invoiceNumber: 'INV-1', totalAmount: '500.00', currency: 'PHP', ...row }));
  const expenses = ['submitted', 'draft', 'approved', 'paid', 'cancelled'].map(status => ({ id: status, organizationId: 'own-org', status, expenseDate: '2026-09-01', totalAmount: '200.00', currency: 'USD', vendor: {name: 'Supplier'} }));
  function matches(row, where) {
    return Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === 'object') {
        if (condition[Op.in]) return condition[Op.in].includes(row[key]);
        if (condition[Op.lt]) return row[key] !== null && row[key] < condition[Op.lt];
        throw new Error('Unhandled query operator');
      }
      return row[key] === condition;
    });
  }
  function model(records) {
    return { findAndCountAll: async query => {
      queries.push(query);
      if (fail) throw new Error('offline');
      const filtered = records.filter(row => matches(row, query.where)).sort((a, b) => {
        for (const [field] of query.order) {
          const result = String(a[field]).localeCompare(String(b[field]));
          if (result) return result;
        }
        return 0;
      });
      return {count: filtered.length, rows: filtered.slice(query.offset, query.offset + query.limit).map(row => ({toJSON: () => row}))};
    } };
  }
  const mocks = {'../sequelize': {getModels: () => unavailable ? null : {SalesInvoice: model(invoices), Expense: model(expenses)}}};
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {module, exports: module.exports, require: name => mocks[name] || originalRequire(name), console: {error() {}}});
  async function request(query = {}) {
    const req = {query: {kind: 'invoices', today: '2026-09-23', ...query}, auth: {user: {organizationId}, permissions: new Set(permissions), roleCodes: superuser ? ['superuser'] : [], isPrivileged: superuser}};
    const res = {statusCode: 200, status(code) {this.statusCode = code; return this;}, json(body) {this.body = body; return this;}};
    await module.exports.getActionCenter(req, res);
    return res;
  }
  return {request, queries, invoices};
}

test('overdue actions use dates and unpaid state, excluding drafts, voids, settlements and other organizations', async () => {
  const e = setup(); const res = await e.request({organizationId: 'other-org'});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Array.from(res.body.data.rows, row => row.id), ['oldest', 'eligible']);
  assert.equal(res.body.data.total, 2); assert.equal(res.body.data.rows[0].daysOverdue, 22);
  assert.equal(res.body.data.rows[0].partiallyPaid, true);
  assert.equal(res.body.data.rows[0].totalAmount, 500);
  assert.equal(res.body.data.rows[0].party, 'No linked customer');
  assert.equal(e.queries[0].where.organizationId, 'own-org');
});

test('only submitted expenses appear in the approval queue', async () => {
  const e = setup(); const res = await e.request({kind: 'expenses'});
  assert.deepEqual(Array.from(res.body.data.rows, row => row.id), ['submitted']);
  assert.equal(res.body.data.rows[0].party, 'Supplier');
  assert.equal(res.body.data.rows[0].daysOverdue, null);
});

test('dashboard permission alone cannot expose either financial queue', async () => {
  const e = setup({permissions: ['dashboard.read']});
  for (const kind of ['invoices', 'expenses']) assert.equal((await e.request({kind})).statusCode, 403);
  assert.equal(e.queries.length, 0);
  const invoiceReader = setup({permissions: ['sales_invoices.read']});
  assert.equal((await invoiceReader.request({kind: 'expenses'})).statusCode, 403);
});

test('superusers must select an organization and regular users cannot operate without a scope', async () => {
  const e = setup({superuser: true});
  assert.equal((await e.request()).statusCode, 400);
  await e.request({organizationId: 'other-org'});
  assert.equal(e.queries[0].where.organizationId, 'other-org');
  const unscoped = setup({organizationId: null});
  assert.equal((await unscoped.request({organizationId: 'other-org'})).statusCode, 400);
  assert.equal(unscoped.queries.length, 0);
});

test('invalid dates, kinds and pages are rejected before querying', async () => {
  const e = setup();
  for (const query of [{today: '2026-02-30'}, {today: 'bad'}, {today: '2026-2-1'}, {kind: 'orders'}, {page: '-1'}, {page: 'NaN'}, {page: '1.5'}, {page: '1000001'}]) {
    assert.equal((await e.request(query)).statusCode, 400);
  }
  assert.equal(e.queries.length, 0);
});

test('pagination preserves total count and deterministic oldest-first ordering', async () => {
  const e = setup();
  for (let i = 0; i < 6; i++) e.invoices.push({...e.invoices[0], id: `extra-${i}`});
  const first = (await e.request()).body.data;
  const second = (await e.request({page: 2})).body.data;
  assert.equal(first.total, 8); assert.equal(first.rows.length, 5);
  assert.equal(second.total, 8); assert.equal(second.rows.length, 3);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 8);
  assert.equal(e.queries[1].offset, 5);
});

test('database errors remain errors rather than reporting empty queues', async () => {
  assert.equal((await setup({unavailable: true}).request()).statusCode, 503);
  assert.equal((await setup({fail: true}).request()).statusCode, 500);
});

test('Action Center bypasses response caching so permissions and actions are checked again', async () => {
  const {readCacheMiddleware} = require('../src/middleware/cache');
  for (const path of ['/api/v1/dashboard/action-center', '/dashboard/action-center']) {
    let continued = false;
    const headers = {};
    await readCacheMiddleware({method: 'GET', path}, {set: (key, value) => {headers[key] = value;}}, () => {continued = true;});
    assert.equal(headers['X-Cache'], 'BYPASS'); assert.equal(continued, true);
  }
});
