const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Standard BIR sales invoice order: VAT is backed out, added back, and WHT is
// deducted last so every line foots to TOTAL AMOUNT DUE.
test('invoice totals follow the standard BIR order with withholding deducted last', () => {
  const html = fs.readFileSync(require.resolve('../src/app/shared/sales-invoice-sheet/sales-invoice-sheet.component.html'), 'utf8');
  const totals = html.slice(html.indexOf('<table class="totals">'));
  const order = ['TOTAL SALES', 'LESS: VAT', 'AMOUNT: Net of VAT', 'LESS: SC/PWD Discount', 'AMOUNT DUE', 'ADD: VAT', 'ADD: Shipping', 'Rounding adjustment', 'LESS: WHT', 'TOTAL AMOUNT DUE'];
  const positions = order.map(label => totals.indexOf(`<th>${label}`));
  positions.forEach((position, i) => assert.ok(position >= 0, `${order[i]} row is missing`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(totals, /AMOUNT DUE<\/th><td>\{\{ money\(doc\.netSales - \(doc\.scPwdDiscount \|\| 0\)\) \}\}/);
});
