const test = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize } = require('sequelize');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { initOrderModel, Order } = require('../src/models/order');
const { initOrganizationModel, Organization } = require('../src/models/organization');
const { initOrderItemSnapshotModel, OrderItemSnapshot } = require('../src/models/order-item-snapshot');
const { initOrderActivityModel, OrderActivity } = require('../src/models/order-activity');
const W = require('../src/services/order-workflow');
const db = new Sequelize('test', 'test', 'test', { dialect: 'mysql', logging: false });
initOrderModel(db); initOrganizationModel(db); initOrderItemSnapshotModel(db); initOrderActivityModel(db);
function fixture(asText) {
  const encode = value => asText ? JSON.stringify(value) : value;
  const order = Order.build({ id: 'order', organizationId: 'org', revision: 1, status: 'confirmed', totalAmount: 112.5,
    workflow: encode({ ...W.newWorkflow({}), fulfilled: { line: 0.125 } }) }, { raw: true, isNewRecord: false });
  order.update = async values => { order.set(values); if (values.workflow) order.setDataValue('workflow', encode(values.workflow)); return order; };
  const line = OrderItemSnapshot.build({ id: 'line', orderId: order.id, name: 'Fabric', quantity: 1.125, metadata: encode({ position: 0 }) }, { raw: true, isNewRecord: false });
  const models = { Order: { findOne: async () => order, sequelize: { transaction: async fn => fn({ LOCK: { UPDATE: 'UPDATE' } }) } }, OrderItemSnapshot: { findAll: async () => [line] },
    SalesInvoice: { findAll: async () => [] }, OrderActivity: { findAll: async () => [], create: async () => {} }, OrderDocument: { findAll: async () => [] } };
  const filename = require.resolve('../src/controllers/order-workflow-controller'); const localRequire = createRequire(filename); const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, require(name) { return name === '../sequelize' ? { getModels: () => models } : localRequire(name); } });
  async function request(method, body = {}, permissions = ['orders.update']) {
    const req = { params: { id: order.id }, body, auth: { user: { organizationId: 'org' }, permissions: new Set(permissions) } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
    await module.exports[method](req, res); return res;
  }
  return { order, line, request, encode, models };
}
for (const asText of [false, true]) {
  test(`order detail and partial fulfillment survive ${asText ? 'MariaDB text' : 'MySQL object'} JSON round trips`, async () => {
    const e = fixture(asText);
    const detail = await e.request('getOrder'); assert.equal(detail.statusCode, 200); assert.equal(detail.body.data.organizationId, 'org');
    assert.equal(typeof detail.body.data.workflow, 'object'); assert.equal(detail.body.data.workflow.fulfilled.line, 0.125); assert.equal(detail.body.data.orderedItemSnapshots[0].metadata.position, 0);
    const partial = await e.request('performAction', { action: 'fulfill', revision: 1, lines: [{ id: 'line', quantity: 0.5 }] });
    assert.equal(partial.statusCode, 200); assert.equal(partial.body.data.fulfillmentStatus, 'partially_fulfilled'); assert.equal(partial.body.data.workflow.fulfilled.line, 0.625);
    const final = await e.request('performAction', { action: 'fulfill', revision: 2, lines: [{ id: 'line', quantity: 0.5 }] });
    assert.equal(final.statusCode, 200); assert.equal(final.body.data.fulfillmentStatus, 'fulfilled'); assert.equal(final.body.data.workflow.fulfilled.line, 1.125); assert.equal(final.body.data.workflow.receipts.length, 2);
    assert.equal((await e.request('performAction', { action: 'fulfill', revision: 3, lines: [{ id: 'line', quantity: 0.001 }] })).statusCode, 400);
    assert.equal(e.order.revision, 3);
  });
}
test('organization settings and activity metadata serialize consistently on MariaDB', () => {
  const org = Organization.build({ orderWorkflowSettings: JSON.stringify(W.PRESETS.services) }, { raw: true, isNewRecord: false });
  assert.equal(W.settings(org.orderWorkflowSettings).inventoryEnabled, false); assert.equal(org.toJSON().orderWorkflowSettings.preset, 'services');
  const activity = OrderActivity.build({ metadata: JSON.stringify({ lines: [{ id: 'line', quantity: 1 }] }) }, { raw: true, isNewRecord: false });
  assert.equal(activity.toJSON().metadata.lines[0].quantity, 1);
});
test('nullable legacy workflows remain null, and malformed saved workflow JSON is not silently replaced', () => {
  const order = Order.build({ workflow: null }, { raw: true }); assert.equal(order.workflow, null);
  for (const invalid of ['invalid', '[]', '"text"', '1']) { order.setDataValue('workflow', invalid); assert.throws(() => order.workflow); }
});

test('order detail identifies the saved withholding rate even when it is no longer active', async () => {
  const e = fixture(false); e.order.withholdingTaxTypeId = 'saved-services';
  let lookup;
  e.models.WithholdingTaxType = { findOne: async query => { lookup = query.where; return { id: 'saved-services', name: 'Services', percentage: 2, isActive: false }; } };
  const result = await e.request('getOrder');
  assert.equal(result.statusCode, 200); assert.equal(result.body.data.withholdingTaxType.name, 'Services');
  assert.equal(lookup.organizationId, 'org'); assert.equal(lookup.id, 'saved-services'); assert.equal(lookup.isActive, undefined);
});

function legacyFixture() {
  const e = fixture(true);
  e.order.set({ workflow: null, status: 'completed', fulfillmentStatus: 'unfulfilled', paymentStatus: 'unpaid' });
  e.line.set({ itemId: 'bags', type: 'product' });
  const invoice = { id: 'invoice', invoiceNumber: '0187', status: 'paid', paymentStatus: 'paid', totalAmount: 112.5, paidAt: new Date('2026-10-01T12:00:00Z') };
  invoice.update = async values => Object.assign(invoice, values);
  e.models.SalesInvoice.findAll = async () => [invoice];
  e.models.Organization = { findByPk: async () => ({ orderWorkflowSettings: {} }) };
  return { ...e, invoice };
}
test('review reopens completed unfulfilled legacy orders, preserves paid invoices and never deducts stock twice', async () => {
  const e = legacyFixture();
  const result = await e.request('performAction', { action: 'reconcile', revision: 1, inventoryDecision: 'already_deducted', note: 'Verified original stock deduction and invoice settlement.' }, ['orders.reconcile']);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const order = result.body.data;
  assert.equal(order.status, 'processing'); assert.equal(order.fulfillmentStatus, 'unfulfilled'); assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.balances.paid, 112.5); assert.equal(order.balances.outstanding, 0);
  assert.equal(order.workflow.stockCommitted.bags, 1.125);
  assert.equal(order.workflow.payments[0].source, 'legacy_invoice'); assert.equal(order.paidAt, '2026-10-01T12:00:00.000Z');
  const fulfilled = await e.request('performAction', { action: 'fulfill', revision: 2, lines: [{ id: 'line', quantity: 1.125 }] });
  assert.equal(fulfilled.statusCode, 200); assert.equal(fulfilled.body.data.fulfillmentStatus, 'fulfilled');
  const refund = await e.request('performAction', { action: 'refund', revision: 3, invoiceId: 'invoice', amount: 12.5, note: 'Refund reference' }, ['orders.refund']);
  assert.equal(refund.statusCode, 200); assert.equal(refund.body.data.paymentStatus, 'partially_paid'); assert.equal(refund.body.data.balances.paid, 100);
});
test('legacy review requires permission, stock decision and known payment amounts', async () => {
  for (const scenario of ['permission', 'inventory', 'partial', 'fulfilled', 'cancelled']) {
    const e = legacyFixture();
    if (scenario === 'partial') e.invoice.paymentStatus = 'partially_paid';
    if (scenario === 'fulfilled') e.order.fulfillmentStatus = 'fulfilled';
    if (scenario === 'cancelled') e.order.status = 'cancelled';
    const result = await e.request('performAction', { action: 'reconcile', revision: 1, note: 'Reviewed', inventoryDecision: scenario === 'inventory' ? '' : 'already_deducted' }, scenario === 'permission' ? [] : ['orders.reconcile']);
    assert.equal(result.statusCode, scenario === 'permission' ? 403 : 400, scenario);
    assert.equal(e.order.workflow, null); assert.equal(e.order.revision, 1);
  }
});
