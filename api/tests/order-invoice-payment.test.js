const test = require('node:test');
const assert = require('node:assert/strict');
const { invoicePaymentSummary, syncLegacyOrderPayment } = require('../src/services/order-invoice-payment');
const W = require('../src/services/order-workflow');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const paid = (totalAmount, extra = {}) => ({ status: 'paid', paymentStatus: 'paid', totalAmount, paidAt: '2026-10-01T12:00:00Z', ...extra });
test('a paid matching invoice settles the order and legacy balance', () => {
  const order = { totalAmount: '87312.50', workflow: null };
  const invoices = [paid('87312.50')];
  assert.equal(invoicePaymentSummary(order, invoices).paymentStatus, 'paid');
  assert.deepEqual(W.balances(order, invoices), { invoiced: 87312.5, paid: 87312.5, toInvoice: 0, outstanding: 0, orderBalance: 0 });
});
test('split payments sum at centavo precision; void and refunded invoices do not settle an order', () => {
  const order = { totalAmount: 0.3 };
  assert.equal(invoicePaymentSummary(order, [paid(0.1), paid(0.2)]).paymentStatus, 'paid');
  assert.equal(invoicePaymentSummary(order, [paid(0.1), paid(0.2, { status: 'void' })]).paymentStatus, 'partially_paid');
  assert.equal(invoicePaymentSummary(order, [paid(0.3, { paymentStatus: 'refunded' })]).paymentStatus, 'refunded');
  const partial = invoicePaymentSummary(order, [paid(0.3, { status: 'partially_paid', paymentStatus: 'partially_paid' })]);
  assert.equal(partial.paymentStatus, 'partially_paid'); assert.equal(partial.paid, 0);
});
test('managed invoice paid flags do not double count workflow receipts', () => {
  assert.equal(W.balances({ totalAmount: 100, workflow: { payments: [{ kind: 'payment', amount: 100 }, { kind: 'refund', amount: 10 }] } }, [paid(100)]).paid, 90);
});
test('payment sync locks and scopes the order, saves audit once and leaves fulfillment unchanged', async () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } }; const writes = []; const audits = [];
  const order = { id: 'order', organizationId: 'org', currency: 'PHP', totalAmount: 100, paymentStatus: 'unpaid', fulfillmentStatus: 'unfulfilled', status: 'completed', revision: 2,
    update: async values => { writes.push(values); Object.assign(order, values); } };
  const models = { Order: { findOne: async query => { assert.equal(query.where.organizationId, 'org'); assert.equal(query.lock, 'UPDATE'); return order; } },
    SalesInvoice: { findAll: async query => { assert.equal(query.where.currency, 'PHP'); assert.equal(query.transaction, transaction); return [paid(100)]; } },
    OrderActivity: { create: async payload => audits.push(payload) } };
  const invoice = { id: 'invoice', orderId: 'order', organizationId: 'org', previous: () => null, sequelize: { models } };
  await syncLegacyOrderPayment(invoice, { transaction }); await syncLegacyOrderPayment(invoice, { transaction });
  assert.equal(writes.length, 1); assert.equal(audits.length, 1); assert.equal(order.paymentStatus, 'paid'); assert.equal(order.revision, 3);
  assert.equal(order.status, 'completed'); assert.equal(order.fulfillmentStatus, 'unfulfilled');
  order.workflow = { payments: [] }; order.paymentStatus = 'unpaid';
  await syncLegacyOrderPayment(invoice, { transaction }); assert.equal(order.paymentStatus, 'unpaid'); assert.equal(writes.length, 1);
});

test('marking a legacy invoice paid synchronizes its order atomically through the invoice controller', async () => {
  for (const failAudit of [false, true]) {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    const order = { id: 'order', organizationId: 'org', currency: 'PHP', workflow: null, totalAmount: 100, paymentStatus: 'unpaid', revision: 0,
      update: async values => Object.assign(order, values) };
    const invoice = { id: 'invoice', orderId: 'order', organizationId: 'org', currency: 'PHP', totalAmount: 100, status: 'issued', paymentStatus: 'unpaid',
      previous: () => 'order' };
    const sequelize = { transaction: async fn => {
      const beforeOrder = { ...order }; const beforeInvoice = { ...invoice };
      try { return await fn(transaction); } catch (error) { Object.assign(order, beforeOrder); Object.assign(invoice, beforeInvoice); throw error; }
    } };
    const models = { Order: { findByPk: async () => order, findOne: async () => order },
      SalesInvoice: { sequelize, findOne: async () => invoice, findAll: async () => [invoice] },
      OrderActivity: { create: async () => { if (failAudit) throw new Error('Audit unavailable'); } } };
    sequelize.models = models; invoice.sequelize = sequelize;
    invoice.update = async (values, options) => {
      assert.equal(options.transaction, transaction);
      Object.assign(invoice, values); await syncLegacyOrderPayment(invoice, options);
    };
    const filename = require.resolve('../src/controllers/sales-invoices-controller'); const actualRequire = createRequire(filename); const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console: { error() {} }, require: name => name === '../sequelize' ? { getModels: () => models } : actualRequire(name) });
    const req = { params: { id: 'invoice' }, body: { status: 'paid' }, auth: { isPrivileged: true, user: { organizationId: 'org' } } };
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports.updateSalesInvoice(req, res);
    assert.equal(res.statusCode, failAudit ? 500 : 200);
    assert.equal(invoice.status, failAudit ? 'issued' : 'paid');
    assert.equal(order.paymentStatus, failAudit ? 'unpaid' : 'paid');
    assert.equal(order.revision, failAudit ? 0 : 1);
  }
});
