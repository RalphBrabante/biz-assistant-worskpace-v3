const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PDFDocument } = require('pdf-lib');
const { Op } = require('sequelize');
const { prepareTaxReturn, computeTaxReturn, section116Rate } = require('../src/services/bir-tax-return');
const { renderTaxReturnPdf } = require('../src/services/bir-tax-return-pdf');

function fixture(code = 'VAT', year = 2026, quarter = 3, extra = {}) {
  const organization = { id: 'org-a', name: 'Example Corporation', country: 'Philippines', currency: 'PHP',
    taxId: '123-456-789-001', addressLine1: '123 Example Street', city: 'Quezon City',
    taxType: { code, percentage: code === 'VAT' ? 12 : 3 }, taxpayerClassification: 'corporation', ...extra };
  const invoices = [{ currency: 'PHP', subtotalAmount: 112000, taxableAmount: 100000, taxAmount: code === 'VAT' ? 12000 : 0, withHoldingTaxAmount: 2000 }];
  const expenses = [{ currency: 'PHP', amount: 56000, taxableAmount: 50000, receiptVatAmount: 6000,
    taxAmount: code === 'VAT' ? 6000 : 0, withHoldingTaxAmount: 1000, totalAmount: 55000 }];
  return { organization, invoices, expenses, preparation: prepareTaxReturn(organization, invoices, expenses, year, quarter) };
}
const details = { rdoCode: '039', taxpayerSize: 'small' };

test('VAT uses the exclusive sales base and gross supplier invoice before withholding', () => {
  const { preparation } = fixture();
  assert.equal(preparation.defaults.vatableSales, 100000);
  assert.equal(preparation.defaults.domesticPurchases, 50000);
  assert.equal(preparation.defaults.domesticInputVat, 6000);
  const result = computeTaxReturn(preparation, details);
  assert.equal(result.computed.taxDue, 6000);
  assert.equal(result.computed.credits, 0); // Income-tax EWT is not credited against VAT.
  assert.equal(result.values.tin, '12345678900001');
});

test('percentage tax uses quarterly sales, with no deduction for expenses or EWT', () => {
  assert.equal(computeTaxReturn(fixture('PT').preparation, details).computed.taxDue, 3000);
  assert.equal(section116Rate(2020, 2), 3);
  assert.equal(section116Rate(2020, 3), 1);
  assert.equal(section116Rate(2023, 2), 1);
  assert.equal(section116Rate(2023, 3), 3);
  assert.equal(computeTaxReturn(fixture('PT', 2022, 4).preparation, details).computed.taxDue, 1000);
});

test('credits, carryover and penalties preserve a signed excess input balance', () => {
  const result = computeTaxReturn(fixture().preparation, { ...details, inputCarryover: 8000, creditableTax: 300,
    amended: true, previousPayment: 100, otherCredits: 50, otherCreditsDescription: 'Verified credit', surcharge: 10, interest: 20 });
  assert.equal(result.computed.taxDue, -2000);
  assert.equal(result.computed.stillPayable, -2450);
  assert.equal(result.computed.totalPayable, -2420);
  assert.equal(result.computed.allowableInput, 14000);
});

test('unclassified zero-tax sales must be allocated before VAT generation', () => {
  const { organization, invoices, expenses } = fixture();
  invoices.push({ currency: 'PHP', taxableAmount: 20000, taxAmount: 0 });
  const prep = prepareTaxReturn(organization, invoices, expenses, 2026, 3);
  assert.equal(prep.unclassifiedSales, 20000);
  assert.throws(() => computeTaxReturn(prep, details), /Allocate/);
  assert.equal(computeTaxReturn(prep, { ...details, exemptSales: 20000 }).computed.totalSales, 120000);
});

test('unknown tax types, foreign currency and incompatible historical templates are rejected', () => {
  for (const prep of [fixture('NONE').preparation, fixture('VAT', 2023).preparation,
    fixture('PT', 2017).preparation, fixture('VAT', 2026, 3, { currency: 'USD' }).preparation,
    fixture('PT', 2026, 3, { taxType: { code: 'PT', percentage: 2 } }).preparation]) {
    assert.equal(prep.supported, false);
    assert.throws(() => computeTaxReturn(prep, details));
  }
  const f = fixture(); f.invoices[0].currency = 'USD';
  assert.equal(prepareTaxReturn(f.organization, f.invoices, f.expenses, 2026, 3).supported, false);
});

test('eligible individual 8% elections do not produce a percentage-tax liability', () => {
  const prep = fixture('PT', 2026, 3, { taxpayerClassification: 'individual' }).preparation;
  assert.throws(() => computeTaxReturn(prep, { ...details, incomeTaxElection: 'eight_percent' }), /exempt/);
  const configured = fixture('PT', 2026, 3, { taxpayerClassification: 'individual', incomeTaxRate: 8 }).preparation;
  assert.throws(() => computeTaxReturn(configured, details), /annual election/);
  assert.equal(computeTaxReturn(configured, { ...details, incomeTaxElection: 'graduated' }).computed.taxDue, 3000);
});

test('return validation rejects malformed values and unsupported ambiguous adjustment', () => {
  const prep = fixture().preparation;
  for (const input of [{ rdoCode: '39' }, { tin: '123' }, { outputVat: -1 }, { inputCarryover: 'NaN' },
    { outputVat: 1.001 }, { previousPayment: 100 }, { otherCredits: 100 }, { settledInputVat: 100 },
    { taxpayerSize: 'corporation' }]) assert.throws(() => computeTaxReturn(prep, { ...details, ...input }));
});

test('zero-transaction quarters produce two-page official PDFs with preserved page sizes', async () => {
  for (const code of ['VAT', 'PT']) {
    const f = fixture(code);
    const prep = prepareTaxReturn(f.organization, [], [], 2026, 3);
    const result = computeTaxReturn(prep, details);
    assert.equal(result.computed.taxDue, 0);
    const bytes = await renderTaxReturnPdf({ ...result, periodStart: '2026-07-01', periodEnd: '2026-09-30' });
    assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(pdf.getTitle(), `BIR ${code === 'VAT' ? '2550Q' : '2551Q'} Q3 2026`);
    assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: code === 'VAT' ? 1008 : 936 });
  }
});

function controllerFixture(privileged = false) {
  const f = fixture();
  const queried = [];
  const models = {
    Organization: { findByPk: async id => { queried.push({ organization: id }); return f.organization; } },
    TaxType: {}, WithholdingTaxType: {}, Vendor: {}, Order: {}, Customer: {},
    SalesInvoice: { findOne: async options => { queried.push(options); return {}; }, findAll: async options => { queried.push(options); return f.invoices.map(row => ({ toJSON: () => row })); } },
    Expense: { findOne: async options => { queried.push(options); return {}; }, findAll: async options => { queried.push(options); return options.group ? [] : f.expenses.map(row => ({ toJSON: () => row })); } },
  };
  const filename = path.join(__dirname, '../src/controllers/reports-controller.js');
  const actualRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer,
    require: name => name === '../sequelize' ? { getModels: () => models }
      : name === '../services/email-service' ? {} : actualRequire(name),
  });
  const req = { body: { year: 2026, quarter: 3, details: { ...details }, sourceRevision: f.preparation.sourceRevision }, query: { organizationId: 'org-b' },
    auth: { user: { id: 'user-a', organizationId: 'org-a' }, roleCodes: privileged ? ['superuser'] : [] } };
  const res = { headers: {}, statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; return this; } };
  return { controller: module.exports, req, res, queried };
}
test('PDF endpoint ignores organization spoofing by a normal user and uses current quarter records', async () => {
  const { controller, req, res, queried } = controllerFixture();
  await controller.generateBirTaxReturnPdf(req, res, error => { throw error; });
  assert.equal(res.statusCode, 200);
  assert.equal(queried[0].organization, 'org-a');
  const source = queried.filter(options => options.where?.issueDate);
  assert.ok(source.length >= 2);
  for (const query of source) {
    assert.equal(query.where.organizationId, 'org-a');
    assert.equal(query.where.status[Op.notIn].join(','), 'void,draft');
    assert.equal(query.where.issueDate[Op.between].join(','), '2026-07-01,2026-09-30');
  }
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.headers['Content-Disposition'], 'inline; filename="bir-2550Q-2026-q3.pdf"');
  assert.ok(Buffer.isBuffer(res.body));
});

test('PDF endpoint requires quarter/year and converts taxpayer errors to 400', async () => {
  const f = controllerFixture(); f.req.body.quarter = 5;
  await f.controller.generateBirTaxReturnPdf(f.req, f.res, error => { throw error; });
  assert.equal(f.res.statusCode, 400); assert.equal(f.queried.length, 0);
  f.req.body.quarter = 3; f.req.body.details.rdoCode = '';
  await f.controller.generateBirTaxReturnPdf(f.req, f.res, error => { throw error; });
  assert.equal(f.res.statusCode, 400); assert.match(f.res.body.message, /RDO/);
});

test('a privileged user must select an organization explicitly', async () => {
  const f = controllerFixture(true); f.req.query = {};
  await f.controller.generateBirTaxReturnPdf(f.req, f.res, error => { throw error; });
  assert.equal(f.res.statusCode, 400); assert.equal(f.queried.length, 0);
});

test('PDF endpoint rejects stale quarterly records instead of silently using an older preview', async () => {
  const f = controllerFixture(); f.req.body.sourceRevision = 'older-revision';
  await f.controller.generateBirTaxReturnPdf(f.req, f.res, error => { throw error; });
  assert.equal(f.res.statusCode, 400); assert.match(f.res.body.message, /changed/);
});
