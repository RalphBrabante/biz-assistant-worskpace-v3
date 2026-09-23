const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/services/order-workflow');
const vat = { code: 'VAT', percentage: 12 };
const item = { id: 'item', name: 'Fabric', type: 'product', unit: 'm', price: 112, currency: 'PHP' };
const lines = () => W.buildLines([{ itemId: 'item', quantity: 1.125 }], new Map([['item', item]]), vat, 'PHP', false);

test('fractional product and service quantities retain three decimal places and tax-inclusive totals', () => {
  const result = lines(); assert.equal(result[0].quantity, 1.125); assert.equal(result[0].lineTotal, 126); assert.equal(result[0].lineTax, 13.5);
  assert.deepEqual(W.totals(result, 10, 2), { subtotalAmount: 126, taxAmount: 13.5, withHoldingTaxAmount: 2.25, shippingAmount: 10, totalAmount: 133.75, discountAmount: 0 });
});
test('custom products and services are allowed without consuming catalog stock', () => {
  const result = W.buildLines([{ name: 'Consulting', quantity: 2.5, unitPrice: 800, type: 'service', unit: 'hours' }, { name: 'Custom goods', type: 'product', quantity: 1, unitPrice: 20 }], new Map(), {}, 'PHP', false);
  assert.equal(result[0].lineTotal, 2000); assert.deepEqual(W.demand(result), {});
});
test('price overrides require permission; missing or cross-organization catalog items fail', () => {
  assert.throws(() => W.buildLines([{ itemId: 'item', quantity: 1, unitPrice: 1 }], new Map([['item', item]]), vat, 'PHP', false), /override permission/);
  assert.throws(() => W.buildLines([{ itemId: 'elsewhere', quantity: 1 }], new Map(), vat, 'PHP', true), /another organization/);
  assert.equal(W.buildLines([{ itemId: 'item', quantity: 1, unitPrice: 100 }], new Map([['item', item]]), vat, 'PHP', true)[0].metadata.priceOverridden, true);
});
test('invalid quantities and amounts cannot silently round or become free order lines', () => {
  for (const quantity of [0, -1, 'not a number', 1.0001, Infinity]) assert.throws(() => W.buildLines([{ name: 'Work', quantity, unitPrice: 10 }], new Map(), {}, 'PHP', false), /Quantity/);
  assert.throws(() => W.totals(lines(), -1), /Shipping/);
  assert.throws(() => W.buildLines([], new Map(), {}, 'PHP', false), /200 order lines/);
});
test('customer or order PO requirement is enforced without imposing POs on ordinary sales', () => {
  const order = { status: 'draft', totalAmount: 100, workflow: W.newWorkflow({}), customerId: null };
  W.confirmationChecks(order);
  assert.throws(() => W.confirmationChecks(order, true), /verified purchase order/);
  order.workflow.poRequired = true;
  assert.throws(() => W.confirmationChecks(order), /verified purchase order/);
  order.customerId = 'customer'; order.customerPoNumber = 'PO-1'; order.workflow.po.status = 'verified'; W.confirmationChecks(order);
  order.workflow.po.status = 'unverified'; assert.throws(() => W.confirmationChecks(order), /verified purchase order/);
});
test('approval threshold is inclusive and confirmation cannot bypass approval or lifecycle', () => {
  const order = { status: 'draft', totalAmount: 100, workflow: W.newWorkflow({ approvalThreshold: 100 }) };
  assert.throws(() => W.confirmationChecks(order), /approval/);
  order.workflow.approval = 'approved'; W.confirmationChecks(order);
  order.status = 'completed'; assert.throws(() => W.confirmationChecks(order), /Only draft/);
});
test('stale and missing revisions are rejected; legacy orders require review', () => {
  for (const revision of [undefined, 1, 2.5, 'abc']) assert.throws(() => W.assertRevision({ revision: 2 }, revision), e => e.status === 409);
  W.assertRevision({ revision: 2 }, '2');
  assert.throws(() => W.assertManaged({ workflow: null }), /legacy order/);
});
test('stock demand aggregates duplicate product lines and excludes services', () => {
  assert.deepEqual(W.demand([{ itemId: 'a', type: 'product', quantity: 0.125 }, { itemId: 'a', type: 'product', quantity: 0.25 }, { itemId: 's', type: 'service', quantity: 10 }]), { a: 0.375 });
});
test('fulfillment state and payment balances remain independent of order completion', () => {
  const l = [{ id: 'a', quantity: 1.5 }, { id: 'b', quantity: 2 }];
  assert.equal(W.fulfillmentStatus(l, {}), 'unfulfilled');
  assert.equal(W.fulfillmentStatus(l, { a: 1 }), 'partially_fulfilled');
  assert.equal(W.fulfillmentStatus(l, { a: 1.5, b: 2 }), 'fulfilled');
  const order = { status: 'completed', totalAmount: 100, workflow: { payments: [{ kind: 'payment', amount: 40 }, { kind: 'refund', amount: 10 }] } };
  assert.deepEqual(W.balances(order, [{ status: 'issued', totalAmount: 60 }, { status: 'void', totalAmount: 20 }]), { invoiced: 60, paid: 30, toInvoice: 40, outstanding: 30, orderBalance: 70 });
});
test('business settings validate thresholds and booleans', () => {
  assert.equal(W.settings(W.PRESETS.services).inventoryEnabled, false);
  assert.equal(W.settings(W.PRESETS.projects).approvalThreshold, 0);
  assert.throws(() => W.settings({ inventoryEnabled: 'false' }), /true or false/);
  assert.throws(() => W.settings({ paymentTermsDays: -1 }), /Payment terms/);
});
test('private PO documents validate signatures and size instead of trusting filename or MIME', () => {
  const doc = W.verifyFile({ originalname: '../po.pdf', buffer: Buffer.from('%PDF-1.7\n') });
  assert.equal(doc.mimeType, 'application/pdf'); assert.equal(doc.name, '.._po.pdf');
  assert.throws(() => W.verifyFile({ originalname: 'fake.pdf', buffer: Buffer.from('<script>bad</script>') }), /Only PDF/);
  assert.throws(() => W.verifyFile({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }), /5 MB/);
});
test('dates reject nonexistent calendar dates', () => {
  assert.equal(W.date('2024-02-29', 'Date'), '2024-02-29');
  assert.throws(() => W.date('2025-02-29', 'Date'), /valid date/);
});

test('cumulative invoice allocation preserves exact tax totals across many small milestones', () => {
  const order = { totalAmount: 1, taxAmount: 0.11 }; const invoices = [];
  for (let i = 0; i < 20; i++) {
    const taxAmount = W.invoiceAllocation(order, invoices, 0.05, 'taxAmount');
    assert.ok(taxAmount >= 0); invoices.push({ status: 'issued', totalAmount: 0.05, taxAmount });
  }
  assert.equal(W.money(invoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0)), 0.11);
});
test('an explicitly requested approval cannot be bypassed even below the configured threshold', () => {
  const order = { status: 'pending', totalAmount: 100, workflow: W.newWorkflow({}) };
  order.workflow.approval = 'pending'; assert.throws(() => W.confirmationChecks(order), /approval/);
  order.workflow.approval = 'approved'; W.confirmationChecks(order);
});
