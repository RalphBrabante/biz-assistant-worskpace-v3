const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeExpenseAmounts: compute, ExpenseCalculationError } = require('../src/services/expense-calculation');
const VAT = { code: 'VAT', percentage: '12.00' };
const PT = { code: 'PT', percentage: '3.00' };
const cases = [
  ['VAT invoice, no withholding', { amount: '11200.00', taxType: VAT }, { taxableAmount: 10000, taxAmount: 1200, withholdingTaxBase: 10000, totalAmount: 11200 }],
  ['VAT invoice, 2% EWT', { amount: 11200, taxType: VAT, withholdingPercentage: 2 }, { withHoldingTaxAmount: 200, totalAmount: 11000 }],
  ['mixed VAT and exempt invoice', { amount: 12200, vatExemptAmount: 1000, taxType: VAT, withholdingPercentage: 2 }, { taxableAmount: 10000, taxAmount: 1200, withholdingTaxBase: 11000, withHoldingTaxAmount: 220, totalAmount: 11980 }],
  ['fully exempt does not mean EWT exempt', { amount: 1000, vatExemptAmount: 1000, taxType: VAT, withholdingPercentage: 2 }, { taxAmount: 0, withholdingTaxBase: 1000, withHoldingTaxAmount: 20, totalAmount: 980 }],
  ['non-VAT supplier to VAT buyer', { amount: 10000, receiptVatAmount: 0, taxType: VAT, withholdingPercentage: 2 }, { taxAmount: 0, withHoldingTaxAmount: 200, totalAmount: 9800 }],
  ['non-VAT buyer does not extract percentage tax', { amount: '5888.18', taxType: PT }, { receiptVatAmount: 0, taxAmount: 0, taxableAmount: 5888.18, totalAmount: 5888.18 }],
  ['non-VAT buyer with non-VAT supplier and EWT', { amount: 10000, taxType: PT, withholdingPercentage: 2 }, { taxAmount: 0, withHoldingTaxAmount: 200, totalAmount: 9800 }],
  ['VAT supplier to non-VAT buyer', { amount: 11200, receiptVatAmount: 1200, taxType: PT, withholdingPercentage: 2 }, { receiptVatAmount: 1200, taxAmount: 0, withholdingTaxBase: 10000, withHoldingTaxAmount: 200, totalAmount: 11000 }],
  ['discount and service charge already included', { amount: 11200, discountAmount: 500, serviceCharge: 200, taxType: VAT, withholdingPercentage: 2 }, { taxAmount: 1200, withHoldingTaxAmount: 200, totalAmount: 11000 }],
  ['configured zero VAT does not fall back to 12%', { amount: 11200, taxType: { code: 'VAT', percentage: 0 } }, { taxAmount: 0, totalAmount: 11200 }],
  ['custom rate', { amount: 105, taxType: { code: 'VAT', percentage: 5 } }, { taxAmount: 5, taxableAmount: 100 }],
  ['configured EWT threshold', { amount: 1120, taxType: VAT, withholdingPercentage: 2, withholdingMinimumBaseAmount: 1001 }, { withHoldingTaxAmount: 0, totalAmount: 1120 }],
  ['threshold is inclusive', { amount: 1120, taxType: VAT, withholdingPercentage: 2, withholdingMinimumBaseAmount: 1000 }, { withHoldingTaxAmount: 20, totalAmount: 1100 }],
  ['small rounding boundary', { amount: '0.05', taxType: VAT }, { taxableAmount: 0.04, taxAmount: 0.01, totalAmount: 0.05 }],
];
for (const [name, input, expected] of cases) test(name, () => {
 const actual = compute(input);
 for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, key);
 assert.equal(Math.round((actual.taxableAmount + actual.vatExemptAmount + actual.receiptVatAmount) * 100), Math.round(actual.amount * 100));
});
for (const invalid of [{ amount: -1 }, { amount: 'abc' }, { amount: Infinity }, { amount: '1.001' }, { amount: 100, vatExemptAmount: 101 }, { amount: 100, vatExemptAmount: 50, receiptVatAmount: 51 }, { amount: 100, serviceCharge: 101 }, { amount: 100, discountAmount: -1 }, { amount: 100, withholdingPercentage: 101 }]) {
 test(`reject invalid money: ${JSON.stringify(invalid)}`, () => assert.throws(() => compute(invalid), ExpenseCalculationError));
}
module.exports = { cases };
