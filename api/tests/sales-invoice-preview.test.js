const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const W = require('../src/services/order-workflow');
function setup() {
  const lines = W.buildLines([{ name: 'Filter', quantity: 1, unitPrice: 112 }], new Map(), { code: 'VAT', percentage: 12 }, 'PHP', false);
  const order = { id: 'order', organizationId: 'org', customerId: 'customer', orderNumber: 'ORD-1', currency: 'PHP', revision: 1, status: 'confirmed', ...W.totals(lines, 0, 2), workflow: W.newWorkflow({}), toJSON() { return { ...this }; }, async update(values) { Object.assign(this, values); } };
  const invoices = [], writes = [];
  const customer = { name: 'Customer', taxId: 'customer-tin' };
  const organization = { id: 'org', name: 'Supplier', taxId: 'supplier-tin' };
  const models = {
    Order: { findOne: async query => query.where.organizationId === 'org' ? order : null, sequelize: { transaction: async fn => fn({ LOCK: { UPDATE: true } }) } },
    OrderItemSnapshot: { findAll: async () => lines },
    Organization: { findByPk: async () => organization }, Customer: { findOne: async () => customer, findByPk: async () => customer },
    SalesInvoice: { findAll: async () => [...invoices], create: async (value, options) => { assert.equal(options.orderWorkflow, true); const row = { ...value, id: 'invoice' }; writes.push(row); invoices.push(row); return row; } },
    OrderActivity: { create: async () => {}, findAll: async () => [] }, OrderDocument: { findAll: async () => [] },
  };
  const filename = require.resolve('../src/controllers/order-workflow-controller'); const originalRequire = createRequire(filename); const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, require: name => name === '../sequelize' ? { getModels: () => models } : originalRequire(name) });
  async function request(method, overrides = {}, organizationId = 'org', permissions = ['sales_invoices.create']) {
    const req = { params: { id: 'order' }, body: { revision: 1, action: 'invoice', amount: 110, issueDate: '2026-10-02', ...overrides }, auth: { user: { organizationId }, permissions: new Set(permissions) } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports[method](req, res); return res;
  }
  return { request, writes, order, organization };
}
test('preview is read-only and issuance saves the exact reviewed document', async () => {
  const e = setup(); const input = { invoiceNumber: '0188', invoiceDetails: { soldTo: 'Invoice buyer', terms: 'Cash' } };
  const preview = await e.request('previewInvoice', input);
  assert.equal(preview.statusCode, 200); assert.equal(e.writes.length, 0); assert.equal(e.order.revision, 1);
  const issued = await e.request('performAction', input);
  assert.equal(issued.statusCode, 200); assert.equal(e.writes.length, 1); assert.equal(e.order.revision, 2);
  assert.deepEqual(e.writes[0].invoiceDocument, preview.body.data.invoiceDocument);
  assert.equal(e.writes[0].invoiceDocument.buyer.name, 'Invoice buyer');
  e.organization.name = 'New supplier name'; assert.equal(e.writes[0].invoiceDocument.seller.name, 'Supplier');
});
test('preview and issue both enforce revision, permission, tenant, state, balance and dates', async () => {
  for (const method of ['previewInvoice', 'performAction']) {
    const e = setup();
    assert.equal((await e.request(method, {}, 'other-org')).statusCode, 404);
    assert.equal((await e.request(method, {}, 'org', [])).statusCode, 403);
    assert.equal((await e.request(method, { revision: 0 })).statusCode, 409);
    assert.equal((await e.request(method, { amount: 111 })).statusCode, 400);
    assert.equal((await e.request(method, { dueDate: '2026-10-01' })).statusCode, 400);
    e.order.status = 'draft'; assert.equal((await e.request(method)).statusCode, 400);
    assert.equal(e.writes.length, 0);
  }
});
