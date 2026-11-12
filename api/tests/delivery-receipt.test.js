const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDeliveryReceiptDocument, deliveredOnReceipts } = require('../src/services/delivery-receipt-document');

const lines = [
  { id: 'b', name: 'Thread', unit: 'cone', quantity: 4, metadata: { position: 2 } },
  { id: 'a', name: 'Fabric', unit: 'm', quantity: 10.5, description: 'Navy', metadata: { position: 1 } },
];
const order = { orderNumber: 'SO-1', customerPoNumber: 'PO-77', shippingAddress: 'Site 2', billingAddress: 'Main office', workflow: { paymentTermsDays: 30 } };
const organization = { taxType: { code: 'VAT', percentage: 12 }, name: 'GIMO', legalName: 'GIMO Supplies', taxId: '499-513-238-000', phone: '0917', addressLine1: 'Blk 2 Lot 26', city: 'San Pedro' };
const customer = { name: 'Acme', legalName: 'Acme Corp', taxId: '123' };
const build = (requested, receipts = [], details) => buildDeliveryReceiptDocument({ order, organization, customer, lines, receipts, requested, details });

test('a delivery receipt freezes customer, PO and item details in order-line order', () => {
  const doc = build([{ id: 'b', quantity: 1 }, { id: 'a', quantity: 2.5 }]);
  assert.equal(doc.deliveredTo, 'Acme Corp'); assert.equal(doc.address, 'Site 2'); assert.equal(doc.taxId, '123');
  assert.equal(doc.poNumber, 'PO-77'); assert.equal(doc.terms, '30 days'); assert.equal(doc.seller.name, 'GIMO Supplies'); assert.equal(doc.seller.vatRegistered, true);
  assert.deepEqual(doc.items.map(i => [i.lineId, i.quantity, i.unit, i.name]), [['a', 2.5, 'm', 'Fabric'], ['b', 1, 'cone', 'Thread']]);
  assert.equal(build([{ id: 'a', quantity: 1 }], [], { deliveredTo: 'Warehouse B', deliveredBy: 'Juan' }).deliveredTo, 'Warehouse B');
});
test('receipts cannot cover more than the ordered quantity, but voided receipts free their quantities', () => {
  const issued = { status: 'issued', receiptDocument: { items: [{ lineId: 'a', quantity: 10 }] } };
  const voided = { status: 'void', receiptDocument: { items: [{ lineId: 'b', quantity: 4 }] } };
  assert.deepEqual(deliveredOnReceipts([issued, voided]), { a: 10 });
  assert.throws(() => build([{ id: 'a', quantity: 0.6 }], [issued]), /would exceed the ordered quantity/);
  assert.equal(build([{ id: 'a', quantity: 0.5 }, { id: 'b', quantity: 4 }], [issued, voided]).items.length, 2);
});
test('delivery receipts reject empty, unknown, duplicate or invalid lines', () => {
  assert.throws(() => build([]), /Enter the quantities/);
  assert.throws(() => build([{ id: 'x', quantity: 1 }]), /Invalid or duplicate/);
  assert.throws(() => build([{ id: 'a', quantity: 1 }, { id: 'a', quantity: 1 }]), /Invalid or duplicate/);
  assert.throws(() => build([{ id: 'a', quantity: 0 }]), /Delivery quantity/);
  assert.throws(() => build([{ id: 'a', quantity: 1 }], [], ['bad']), /Invalid delivery receipt details/);
});
