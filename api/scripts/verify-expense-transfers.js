'use strict';
// Opt-in MySQL integration: isolated schema, table definitions only, no business rows.
// Run: npm run test:expenses:mysql (requires CREATE/DROP DATABASE privileges).
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Sequelize } = require('sequelize');
const config = require('../src/config/config');
const { initModels } = require('../src/models');
const { computeExpenseAmounts } = require('../src/services/expense-calculation');

async function main() {
  const options = { ...config[config.env], logging: false };
  const source = options.database;
  const target = `schema_review_test_transfer_${randomUUID().replaceAll('-', '')}`;
  if (!/^[a-zA-Z0-9_]+$/.test(source) || target === source) throw new Error('Unsafe test database name.');
  const admin = new Sequelize(source, options.username, options.password, options);
  let db; let created = false;
  try {
    await admin.query(`CREATE DATABASE \`${target}\``); created = true;
    db = new Sequelize(target, options.username, options.password, { ...options, database: target });
    const models = initModels(db);
    for (const name of ['Expense', 'Organization', 'OrganizationUser', 'TaxType', 'WithholdingTaxType', 'Vendor', 'VendorOrganization', 'QuarterlyExpenseReport', 'User', 'Role', 'UserRole']) {
      const table = models[name].getTableName();
      assert.match(table, /^[a-zA-Z0-9_]+$/);
      await db.query(`CREATE TABLE \`${table}\` LIKE \`${source}\`.\`${table}\``);
    }
    const notifications = []; const errors = [];
    function controller(file) {
      const filename = path.resolve(__dirname, `../src/controllers/${file}-controller.js`);
      const actual = createRequire(filename); const module = { exports: {} };
      const mocks = {
        '../sequelize': { getModels: () => models },
        '../services/organization-currency': { getOrganizationCurrency: async (id) => (await models.Organization.findByPk(id)).currency },
        '../services/message-service': { getActorDisplayName: () => 'Test actor', createOrganizationMessage: async (data) => notifications.push(data) },
        '../services/email-service': { sendQuarterlyExpenseReportReadyEmail: async () => {} },
        '../services/storage-service': { StorageProviderError: class extends Error {} },
      };
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console: { error: (...args) => errors.push(args) }, require: name => mocks[name] || actual(name) }, { filename });
      return module.exports;
    }
    const expenses = controller('expenses');
    const reports = controller('reports');
    const vat = await models.TaxType.create({ code: 'VAT', name: 'VAT', percentage: 12 });
    const pt = await models.TaxType.create({ code: 'PT', name: 'Percentage Tax', percentage: 3 });
    const organizations = [];
    for (const [name, taxTypeId] of [['Source', vat.id], ['Destination', pt.id], ['Third', vat.id]]) {
      organizations.push(await models.Organization.create({ name, taxTypeId, addressLine1: 'Test only', city: 'Test', phone: '000', contactEmail: `${name.toLowerCase()}@example.invalid`, currency: 'PHP' }));
    }
    const [a, b, c] = organizations;
    const ewt = [];
    for (const org of organizations) ewt.push(await models.WithholdingTaxType.create({ organizationId: org.id, code: 'WC158', name: 'Test withholding', percentage: 2, minimumBaseAmount: 0, appliesTo: 'expense' }));
    const vendor = await models.Vendor.create({ organizationId: a.id, name: 'Fixture vendor', taxId: 'TEST-TIN' });
    const base = computeExpenseAmounts({ amount: '12200.00', vatExemptAmount: '1000.00', receiptVatAmount: '1200.00', discountAmount: '200.00', serviceCharge: '100.00', taxType: { code: 'VAT', percentage: 12 }, withholdingPercentage: 2 });
    async function receipt(extra = {}) {
      return models.Expense.create({ organizationId: a.id, vendorId: vendor.id, vendorTaxId: vendor.taxId, category: 'Fixture expense', expenseDate: '2026-09-24', expenseNumber: randomUUID(), currency: 'PHP', taxTypeId: vat.id, withholdingTaxTypeId: ewt[0].id, ...base, ...extra });
    }
    function req(id, selection = {}) { return { params: { id }, body: selection, query: selection, auth: { roleCodes: ['superuser'] } }; }
    async function call(handler, request) {
      const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler(request, res, error => { throw error; }); return res;
    }
    async function reviewed(row, targetOrg, extra = {}) {
      const request = req(row.id, { targetOrganizationId: targetOrg.id, ...extra });
      const res = await call(expenses.previewExpenseTransfer, request);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.ready, true);
      return req(row.id, { ...request.body, withholdingTaxTypeId: res.body.data.withholdingTaxTypeId, receiptVatAmount: res.body.data.receiptVatAmount, previewToken: res.body.data.previewToken });
    }
    const row = await receipt();
    // Real report generation and transfer use the same aggregate and locking protocol.
    for (const org of [a, b]) {
      const res = await call(reports.computeQuarterlyExpenseReport, req(null, { organizationId: org.id, year: 2026, quarter: 3 }));
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    }
    const request = await reviewed(row, b);
    assert.equal(await models.VendorOrganization.count(), 0, 'preview must not link vendors');
    const moved = await call(expenses.transferExpense, request);
    assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
    await row.reload();
    assert.equal(row.organizationId, b.id); assert.equal(row.taxAmount, '0.00'); assert.equal(row.receiptVatAmount, '1200.00');
    assert.equal(row.withholdingTaxTypeId, ewt[1].id); assert.equal(row.withHoldingTaxAmount, '220.00'); assert.equal(row.totalAmount, '11980.00');
    assert.equal(await models.VendorOrganization.count(), 1);
    const sourceReport = await models.QuarterlyExpenseReport.findOne({ where: { organizationId: a.id } });
    const targetReport = await models.QuarterlyExpenseReport.findOne({ where: { organizationId: b.id } });
    assert.equal(sourceReport.expenseCount, 0); assert.equal(sourceReport.taxAmount, '0.00'); assert.equal(sourceReport.totalAmount, '0.00');
    assert.equal(targetReport.expenseCount, 1); assert.equal(targetReport.amount, '12200.00'); assert.equal(targetReport.taxAmount, '0.00'); assert.equal(targetReport.totalAmount, '11980.00');
    assert.equal(notifications.length, 1);
    assert.equal((await call(expenses.transferExpense, request)).statusCode, 409, 'replay cannot transfer twice');
    assert.equal((await call(expenses.transferExpense, await reviewed(row, a))).statusCode, 200);
    await row.reload(); assert.equal(row.taxAmount, '1200.00'); assert.equal(row.withholdingTaxTypeId, ewt[0].id); assert.equal(row.totalAmount, '11980.00');
    console.log('PASS: actual MySQL VAT/PT round trip, target withholding ID, vendor linking, report refresh, and replay rejection.');

    const stale = await reviewed(row, b);
    await ewt[1].update({ percentage: 5 });
    assert.equal((await call(expenses.transferExpense, stale)).statusCode, 409);
    await row.reload(); assert.equal(row.organizationId, a.id);
    await ewt[1].update({ percentage: 2 });
    const staleExpense = await reviewed(row, b);
    await row.update({ amount: '12201.00' });
    assert.equal((await call(expenses.transferExpense, staleExpense)).statusCode, 409);
    await row.update({ amount: '12200.00' });
    const noToken = await call(expenses.transferExpense, req(row.id, { targetOrganizationId: b.id }));
    assert.equal(noToken.statusCode, 409);
    const unauthorized = req(row.id, { targetOrganizationId: b.id });
    unauthorized.auth = { userId: randomUUID(), user: { organizationId: a.id }, roleCodes: [] };
    assert.equal((await call(expenses.previewExpenseTransfer, unauthorized)).statusCode, 403);
    assert.equal((await call(expenses.transferExpense, unauthorized)).statusCode, 403);
    await b.update({ currency: 'USD' });
    assert.equal((await call(expenses.previewExpenseTransfer, req(row.id, { targetOrganizationId: b.id }))).statusCode, 400);
    await b.update({ currency: 'PHP' });
    console.log('PASS: stale tax settings/amounts, missing preview, permissions, and currency mismatch block transfer.');

    const otherVendor = await models.Vendor.create({ organizationId: a.id, name: 'Rollback vendor' });
    const rollbackRow = await receipt({ vendorId: otherVendor.id, vendorTaxId: null });
    const rollbackRequest = await reviewed(rollbackRow, b);
    const notificationCount = notifications.length;
    models.QuarterlyExpenseReport.addHook('beforeUpdate', 'test-failure', () => { throw new Error('Injected report write failure'); });
    assert.equal((await call(expenses.transferExpense, rollbackRequest)).statusCode, 500);
    models.QuarterlyExpenseReport.removeHook('beforeUpdate', 'test-failure');
    await rollbackRow.reload(); assert.equal(rollbackRow.organizationId, a.id); assert.equal(rollbackRow.taxAmount, '1200.00');
    assert.equal(await models.VendorOrganization.count({ where: { vendorId: otherVendor.id } }), 0);
    assert.equal(notifications.length, notificationCount);
    await targetReport.reload(); assert.equal(targetReport.expenseCount, 0);
    console.log('PASS: report write failure rolls back expense, vendor link, report changes, and notifications.');

    const parallel = await receipt();
    const requests = await Promise.all([reviewed(parallel, b), reviewed(parallel, c)]);
    const results = await Promise.all(requests.map(request => call(expenses.transferExpense, request)));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409], JSON.stringify(results.map(r => r.body)));
    assert.equal(notifications.length, notificationCount + 1);
    const duplicate = await receipt({ organizationId: b.id, expenseNumber: row.expenseNumber, withholdingTaxTypeId: ewt[1].id });
    assert.equal((await call(expenses.previewExpenseTransfer, req(row.id, { targetOrganizationId: b.id }))).statusCode, 409);
    await duplicate.destroy();
    // A note edit that read the old organization must not overwrite a concurrent transfer.
    let racing = true;
    models.Expense.addHook('beforeBulkUpdate', 'test-concurrent-transfer', async () => {
      if (!racing) return; racing = false;
      assert.equal((await call(expenses.transferExpense, await reviewed(row, b))).statusCode, 200);
    });
    const edit = await call(expenses.updateExpense, req(row.id, { notes: 'Stale edit' }));
    models.Expense.removeHook('beforeBulkUpdate', 'test-concurrent-transfer');
    assert.equal(edit.statusCode, 409, JSON.stringify(edit.body));
    await row.reload(); assert.equal(row.organizationId, b.id); assert.equal(row.taxTypeId, pt.id); assert.equal(row.taxAmount, '0.00');
    console.log('PASS: concurrent transfers commit once, duplicate numbers reject, and stale edits cannot overwrite transferred taxes.');
    const forward = await receipt();
    const backward = await receipt({ organizationId: b.id, taxTypeId: pt.id, taxAmount: 0, withholdingTaxTypeId: ewt[1].id });
    const opposite = await Promise.all([reviewed(forward, b), reviewed(backward, a)]);
    const crossed = await Promise.all(opposite.map(request => call(expenses.transferExpense, request)));
    assert.deepEqual(crossed.map(r => r.statusCode), [200, 200], JSON.stringify(crossed.map(r => r.body)));
    // Regenerating a report concurrently must not overwrite the transfer's newer totals.
    const duringReport = await receipt();
    const transferRequest = await reviewed(duringReport, b);
    const together = await Promise.all([
      call(expenses.transferExpense, transferRequest),
      call(reports.computeQuarterlyExpenseReport, req(null, { organizationId: b.id, year: 2026, quarter: 3 })),
    ]);
    assert.deepEqual(together.map(r => r.statusCode), [200, 200]);
    await targetReport.reload();
    const currentTargetCount = await models.Expense.count({ where: { organizationId: b.id } });
    assert.equal(targetReport.expenseCount, currentTargetCount);
    assert.equal(targetReport.totalAmount, (currentTargetCount * 11980).toFixed(2));
    const cancelled = await receipt({ status: 'cancelled' });
    assert.equal((await call(expenses.transferExpense, await reviewed(cancelled, b))).statusCode, 200);
    await targetReport.reload(); assert.equal(targetReport.expenseCount, currentTargetCount);
    assert.equal(targetReport.totalAmount, (currentTargetCount * 11980).toFixed(2));
    console.log('PASS: opposite-direction transfers, concurrent report generation, and cancelled-expense exclusions.');
    assert.equal(errors.length, 1, `Only the injected failure should log an error: ${errors.map(e => e.join(' '))}`);
  } finally {
    if (db) await db.close();
    if (created) await admin.query(`DROP DATABASE \`${target}\``);
    await admin.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
