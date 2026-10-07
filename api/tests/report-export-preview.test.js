const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Op } = require('sequelize');
function setup(kind, missing = false, privileged = false) {
  const queries = [];
  const report = { id: 'report-a', organizationId: 'org-a', currency: 'PHP', periodStart: '2026-07-01', periodEnd: '2026-09-30' };
  const invoice = { id: 'i1', invoiceDocument: { buyer: { name: 'Frozen buyer', taxId: '0010020030000' } }, amount: 112, taxableAmount: 100, withHoldingTaxAmount: 2, subtotalAmount: 100, taxAmount: 12, totalAmount: 110 };
  const expense = { id: 'e1', vendorTaxId: '0010020030000', withholdingTaxBase: 100, amount: 112, taxAmount: 12, withHoldingTaxAmount: 2, totalAmount: 110 };
  const models = { Organization: {}, Customer: {}, Vendor: {}, Order: {}, TaxType: {}, WithholdingTaxType: {},
    QuarterlySalesReport: { findOne: async query => { queries.push(query); return missing ? null : report; } },
    QuarterlyExpenseReport: { findOne: async query => { queries.push(query); return missing ? null : report; } },
    SalesInvoice: { findAll: async query => { queries.push(query); return [invoice]; } },
    Expense: { findAll: async query => { queries.push(query); return [expense]; } },
  };
  const filename = require.resolve('../src/controllers/reports-controller.js');
  const actualRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer,
    require: name => name === '../sequelize' ? { getModels: () => models } : name === '../services/email-service' ? {} : actualRequire(name) });
  const req = { params: { id: report.id }, query: { organizationId: 'forged-org' }, auth: { user: { organizationId: 'org-a' }, roleCodes: privileged ? ['superuser'] : [] } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const action = kind === 'sales' ? 'getQuarterlySalesReportPreviewById' : 'getQuarterlyExpenseReportPreviewById';
  return { run: () => module.exports[action](req, res, error => { throw error; }), queries, res, models, invoice, expense };
}
for (const kind of ['sales', 'expenses']) {
  test(`${kind} export preview keeps tenant and period scope, supplies BIR identity and ATCs without pagination`, async () => {
    const e = setup(kind); await e.run(); assert.equal(e.res.statusCode, 200);
    assert.equal(e.queries[0].where.organizationId, 'org-a');
    for (const field of ['taxId', 'rdoCode', 'taxpayerClassification']) assert.ok(e.queries[0].include[0].attributes.includes(field));
    const query = e.queries[1]; assert.equal(query.where.organizationId, 'org-a'); assert.equal(query.limit, undefined); assert.equal(query.offset, undefined);
    assert.equal(query.where[kind === 'sales' ? 'issueDate' : 'expenseDate'][Op.between][0], '2026-07-01');
    assert.equal(query.where.status[Op.ne], kind === 'sales' ? 'void' : 'cancelled');
    const withholding = query.include.find(i => i.as === 'withholdingTaxType'); assert.ok(withholding.attributes.includes('code')); assert.equal(withholding.required, false);
    if (kind === 'sales') {
      const customer = query.include.find(i => i.as === 'order').include[0]; assert.ok(customer.attributes.includes('legalName')); assert.ok(customer.attributes.includes('type'));
      for (const field of ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country']) assert.ok(customer.attributes.includes(field), field);
      assert.equal(e.res.body.data.salesInvoices[0], e.invoice);
    } else {
      const vendor = query.include.find(i => i.as === 'vendor');
      for (const field of ['addressLine1', 'addressLine2', 'barangay', 'city', 'state', 'province', 'postalCode', 'country']) assert.ok(vendor.attributes.includes(field), field);
      assert.equal(e.res.body.data.expenses[0], e.expense);
    }
  });
  test(`${kind} missing or out-of-scope report does not load transaction data`, async () => {
    const e = setup(kind, true); await e.run(); assert.equal(e.res.statusCode, 404); assert.equal(e.queries.length, 1);
  });
  test(`${kind} superuser selected scope is applied to the report lookup`, async () => {
    const e = setup(kind, true, true); await e.run(); assert.equal(e.queries[0].where.organizationId, 'forged-org');
  });
}
