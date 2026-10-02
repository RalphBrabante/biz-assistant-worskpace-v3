const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/services/order-workflow');
const { buildInvoiceDocument } = require('../src/services/sales-invoice-document');
function fixture() {
  const lines = W.buildLines([{ name: 'Nylon syringe filter', unit: 'canister', quantity: 1, unitPrice: 3057 }], new Map(), { code: 'VAT', percentage: 12 }, 'PHP', false);
  const order = { orderNumber: 'ORD-1', ...W.totals(lines, 0, 2), workflow: { paymentTermsDays: 0 }, billingAddress: 'Billing address' };
  const organization = { name: 'GIMO Laboratory Supplies', taxId: 'seller-tin', addressLine1: 'Seller address', phone: '123' };
  const customer = { name: 'Customer', taxId: 'customer-tin', addressLine1: 'Customer address' };
  return { order, organization, customer, lines, invoice: { ...order }, details: {} };
}
test('sample layout uses authoritative order amounts and deducts WHT exactly once', () => {
  const f = fixture(); f.details = { soldTo: 'Invoice customer', tax: 9999, total: 1, seller: { name: 'Wrong' } };
  const doc = buildInvoiceDocument(f);
  assert.equal(doc.seller.name, 'GIMO Laboratory Supplies'); assert.equal(doc.buyer.name, 'Invoice customer');
  assert.equal(doc.buyer.address, 'Billing address'); assert.equal(doc.buyer.taxId, 'customer-tin'); assert.equal(doc.terms, 'Cash');
  assert.equal(doc.grossSales, 3057); assert.equal(doc.tax, 327.54); assert.equal(doc.netSales, 2729.46);
  assert.equal(doc.withholding, 54.59); assert.equal(doc.total, 3002.41);
  assert.equal(doc.items[0].amount, 3057); assert.equal(doc.items[0].quantity, 1);
  assert.equal(W.money(doc.netSales + doc.tax - doc.withholding), doc.total);
  f.organization.name = 'Changed'; f.customer.name = 'Changed'; f.lines[0].name = 'Changed';
  assert.equal(doc.seller.name, 'GIMO Laboratory Supplies'); assert.equal(doc.items[0].name, 'Nylon syringe filter');
});
test('partial billing does not present all order goods as billed in full', () => {
  const f = fixture(); const amount = 1000;
  f.invoice = Object.fromEntries(['subtotalAmount', 'taxAmount', 'withHoldingTaxAmount'].map(field => [field, W.invoiceAllocation(f.order, [], amount, field)]));
  f.invoice.totalAmount = amount;
  const doc = buildInvoiceDocument(f);
  assert.equal(doc.partial, true); assert.equal(doc.items.length, 1); assert.match(doc.items[0].name, /Partial billing/);
  assert.equal(doc.items[0].amount, doc.grossSales); assert.equal(doc.shipping, 0);
  assert.equal(W.money(doc.netSales + doc.tax + doc.roundingAdjustment - doc.withholding), amount);
});
test('shipping and fractional allocations reconcile without masquerading as VAT or withholding', () => {
  const f = fixture(); f.order = { ...f.order, ...W.totals(f.lines, 100, 2) };
  const invoices = [];
  for (const amount of [0.05, 0.05, 1000, W.money(f.order.totalAmount - 1000.1)]) {
    const invoice = { status: 'issued', totalAmount: amount };
    for (const field of ['subtotalAmount', 'taxAmount', 'withHoldingTaxAmount', 'shippingAmount']) invoice[field] = W.invoiceAllocation(f.order, invoices, amount, field);
    const doc = buildInvoiceDocument({ ...f, invoice });
    assert.equal(W.money(doc.grossSales + doc.shipping + doc.roundingAdjustment - doc.withholding), amount);
    invoices.push(invoice);
  }
  for (const field of ['subtotalAmount', 'taxAmount', 'withHoldingTaxAmount', 'shippingAmount']) assert.equal(W.money(invoices.reduce((sum, i) => sum + i[field], 0)), f.order[field]);
});
test('unclassified non-VAT sales do not invent exempt or zero-rated amounts', () => {
  const f = fixture(); f.invoice.taxAmount = 0;
  const doc = buildInvoiceDocument(f);
  assert.equal(doc.vatableSales, null); assert.equal(doc.vatExemptSales, null); assert.equal(doc.zeroRatedSales, null);
});
test('invoice-only fields are bounded and invalid details are rejected', () => {
  assert.throws(() => buildInvoiceDocument({ ...fixture(), details: [] }), /Invalid invoice details/);
  assert.throws(() => buildInvoiceDocument({ ...fixture(), details: { taxId: 'x'.repeat(81) } }), /too long/);
});
