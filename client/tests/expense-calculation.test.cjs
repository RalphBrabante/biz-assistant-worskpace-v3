const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/core/expense-calculation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsObject = {};
vm.runInNewContext(source, { exports: exportsObject });
const { computeExpenseAmounts: clientCompute } = exportsObject;
const { computeExpenseAmounts: serverCompute } = require('../../api/src/services/expense-calculation');
// Contrast every company/supplier combination over mixed receipts and centavo boundaries.
for (const code of ['VAT', 'PT', 'NON_VAT']) test(`frontend/API parity for ${code}`, () => {
 for (let cents = 1; cents <= 50000; cents += 37) {
  const input = { amount: (cents / 100).toFixed(2), vatExemptAmount: (Math.floor(cents / 3) / 100).toFixed(2), taxType: { code, percentage: code === 'VAT' ? 12 : 3 }, withholdingPercentage: 2, discountAmount: '0.50' };
  assert.equal(JSON.stringify(clientCompute(input)), JSON.stringify(serverCompute(input)));
 }
 for (const receiptVatAmount of [0, 1200]) {
  const input = { amount: 11200, receiptVatAmount, taxType: { code, percentage: code === 'VAT' ? 12 : 3 }, withholdingPercentage: 2 };
  assert.equal(JSON.stringify(clientCompute(input)), JSON.stringify(serverCompute(input)));
 }
});
