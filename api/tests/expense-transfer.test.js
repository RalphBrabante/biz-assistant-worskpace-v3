const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExpenseTransferPreview: preview, ExpenseTransferError } = require('../src/services/expense-transfer');
function fixture() {
  const source = { id: 'expense', organizationId: 'source', currency: 'PHP', amount: '12200.00', vatExemptAmount: '1000.00', receiptVatAmount: '1200.00', taxAmount: '1200.00', taxType: { code: 'VAT' }, withholdingTaxTypeId: 'source-ewt', withholdingTaxType: { code: 'WC158' }, withHoldingTaxAmount: '220.00', totalAmount: '11980.00', serviceCharge: '100.00', discountAmount: '200.00' };
  const target = { id: 'target', currency: 'PHP', isActive: true, taxTypeId: 'target-tax', taxType: { code: 'VAT', percentage: '12.00', isActive: true } };
  const types = [{ id: 'target-ewt', organizationId: 'target', code: 'WC158', percentage: '2.00', minimumBaseAmount: '0.00', appliesTo: 'expense', isActive: true }];
  return { source, target, types };
}
test('map withholding by tax code across organization-specific IDs and preserve mixed receipt totals', () => {
  const f = fixture(); const p = preview(f.source, f.target, f.types);
  assert.equal(p.withholdingTaxTypeId, 'target-ewt');
  assert.deepEqual(p.amounts, { amount: 12200, vatExemptAmount: 1000, receiptVatAmount: 1200, taxableAmount: 10000, taxAmount: 1200, withholdingTaxBase: 11000, withHoldingTaxAmount: 220, discountAmount: 200, serviceCharge: 100, totalAmount: 11980 });
});
test('VAT to non-VAT to VAT round trip preserves supplier VAT, exempt portion, gross, discounts and payable', () => {
  const f = fixture(); f.target.taxType = { code: 'PT', percentage: 3 }; const first = preview(f.source, f.target, f.types);
  assert.equal(first.amounts.taxAmount, 0); assert.equal(first.amounts.receiptVatAmount, 1200);
  const moved = { ...f.source, ...first.amounts, taxType: f.target.taxType };
  f.target.taxType = { code: 'VAT', percentage: 5 };
  const second = preview(moved, f.target, f.types);
  assert.equal(second.amounts.taxAmount, 1200); assert.equal(second.amounts.totalAmount, 11980);
});
for (const threshold of ['10999.99', '11000.00', '11000.01']) test(`destination rate and minimum base apply at threshold ${threshold}`, () => {
  const f = fixture(); Object.assign(f.types[0], { percentage: '5.00', minimumBaseAmount: threshold });
  const p = preview(f.source, f.target, f.types);
  assert.equal(p.amounts.withHoldingTaxAmount, Number(threshold) > 11000 ? 0 : 550);
});
for (const mutate of [f => f.types.splice(0), f => f.types[0].isActive = false, f => f.types[0].appliesTo = 'invoice', f => f.types[0].organizationId = 'other', f => f.types.push({ ...f.types[0], id: 'ambiguous' }), f => f.source.withholdingTaxType = null]) test(`unavailable or ambiguous withholding requires a choice (${mutate})`, () => {
  const f = fixture(); mutate(f); const p = preview(f.source, f.target, f.types);
  assert.equal(p.ready, false); assert.equal(p.previewToken, null); assert.equal(p.requiresWithholdingSelection, true);
  const none = preview(f.source, f.target, f.types, { withholdingTaxTypeId: null });
  assert.equal(none.ready, true); assert.equal(none.amounts.withHoldingTaxAmount, 0); assert.equal(none.amounts.totalAmount, 12200);
});
test('historical withholding without a tax ID is not silently discarded', () => {
  const f = fixture(); f.source.withholdingTaxTypeId = null;
  assert.equal(preview(f.source, f.target, f.types).requiresWithholdingSelection, true);
});
test('explicit None overrides a matching source code', () => {
  const f = fixture(); const p = preview(f.source, f.target, f.types, { withholdingTaxTypeId: '' });
  assert.equal(p.withholdingTaxTypeId, null); assert.equal(p.amounts.withHoldingTaxAmount, 0);
});
test('explicit invalid destination withholding is rejected', () => {
  const f = fixture(); assert.throws(() => preview(f.source, f.target, f.types, { withholdingTaxTypeId: 'source-ewt' }), ExpenseTransferError);
});
test('recorded supplier VAT cannot be replaced by supplied transfer totals', () => {
  const f = fixture(); const p = preview(f.source, f.target, f.types, { receiptVatAmount: 0, taxAmount: 999, amount: 1 });
  assert.equal(p.amounts.receiptVatAmount, 1200); assert.equal(p.amounts.amount, 12200);
});
test('legacy VAT expenses recover the recorded VAT, while old percentage tax is never treated as supplier VAT', () => {
  const f = fixture(); f.source.receiptVatAmount = null;
  assert.equal(preview(f.source, f.target, f.types).amounts.receiptVatAmount, 1200);
  f.source.taxType = { code: 'PT' }; f.source.taxAmount = 171.5;
  const p = preview(f.source, f.target, f.types); assert.equal(p.requiresReceiptVat, true); assert.equal(p.ready, false);
  for (const receiptVatAmount of [0, '1200.00']) {
    const confirmed = preview(f.source, f.target, f.types, { receiptVatAmount });
    assert.equal(confirmed.amounts.receiptVatAmount, Number(receiptVatAmount));
  }
});
test('recorded zero VAT is preserved when moving to a VAT organization', () => {
  const f = fixture(); f.source.receiptVatAmount = '0.00';
  const p = preview(f.source, f.target, f.types); assert.equal(p.amounts.taxAmount, 0); assert.equal(p.amounts.withHoldingTaxAmount, 244);
});
for (const mutate of [f => f.target.currency = 'USD', f => f.source.currency = null, f => f.target.isActive = false, f => f.target.taxType.isActive = false, f => f.target.taxType = null, f => f.target.taxType.code = 'UNKNOWN', f => f.types[0].percentage = null, f => f.types[0].percentage = '101.00']) test(`invalid transfer configuration fails closed (${mutate})`, () => {
  const f = fixture(); mutate(f); assert.throws(() => preview(f.source, f.target, f.types));
});
for (const mutate of [f => f.source.organizationId = 'other', f => f.source.updatedAt = new Date(), f => f.source.amount = '12201.00', f => f.target.taxType.percentage = '5.00', f => f.types[0].minimumBaseAmount = '12000.00', f => f.types[0].percentage = '5.00']) test(`preview fingerprint changes when a reviewed input changes (${mutate})`, () => {
  const f = fixture(); const before = preview(f.source, f.target, f.types).previewToken; mutate(f);
  assert.notEqual(preview(f.source, f.target, f.types).previewToken, before);
});
test('tiny amounts retain cent precision through withholding rounding', () => {
  const f = fixture(); Object.assign(f.source, { amount: '0.05', vatExemptAmount: '0', receiptVatAmount: '0.01', serviceCharge: 0, discountAmount: 0 });
  f.types[0].percentage = '50.00'; const p = preview(f.source, f.target, f.types);
  assert.equal(p.amounts.withHoldingTaxAmount, 0.02); assert.equal(p.amounts.totalAmount, 0.03);
});
