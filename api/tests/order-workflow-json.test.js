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
  async function request(method, body = {}) {
    const req = { params: { id: order.id }, body, auth: { user: { organizationId: 'org' }, permissions: new Set(['orders.update']) } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
    await module.exports[method](req, res); return res;
  }
  return { order, line, request, encode };
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
