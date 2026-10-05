const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PDFDocument, decodePDFRawStream } = require('pdf-lib');
const { Op } = require('sequelize');
const { prepareReportDocuments, computeReportDocument, graduatedTax } = require('../src/services/bir-report-documents');
const { renderReportDocumentPdf } = require('../src/services/bir-report-documents-pdf');
const { prepareTaxReturn, computeTaxReturn } = require('../src/services/bir-tax-return');
const { renderTaxReturnPdf } = require('../src/services/bir-tax-return-pdf');

function fixture(classification = 'individual', quarter = 3, extra = {}) {
  const organization = { id: 'org-a', name: 'EXAMPLE TAXPAYER', taxId: '12345678901234', country: 'Philippines', currency: 'PHP', addressLine1: '123 EXAMPLE STREET', city: 'QUEZON CITY',
    taxpayerClassification: classification, deductionMethod: 'itemized', taxType: { code: 'PT', percentage: 3 }, ...extra };
  const invoices = [1, 2, 3].map(q => ({ id: `i${q}`, currency: 'PHP', issueDate: `2026-0${q * 3}-05`, taxableAmount: 1000000, taxAmount: 0, withHoldingTaxAmount: 20000, totalAmount: 980000,
    invoiceNumber: `INV-${q}`, withholdingTaxType: { code: 'WI160', percentage: 2 }, order: { customer: { id: 'customer', name: 'CUSTOMER', taxId: '98765432100000' } } }));
  const expenses = [1, 2, 3].map(q => ({ id: `e${q}`, currency: 'PHP', expenseDate: `2026-0${q * 3}-06`, amount: 200000, receiptVatAmount: 0, taxAmount: 0, taxableAmount: 200000, withholdingTaxBase: 200000, withHoldingTaxAmount: 4000, totalAmount: 196000,
    expenseNumber: `EXP-${q}`, vendorId: 'vendor', vendor: { name: 'SUPPLIER', taxId: '98765432100123', addressLine1: 'SUPPLIER STREET', city: 'MANILA' }, withholdingTaxTypeId: 'ewt', withholdingTaxType: { code: 'WI160', name: 'SUPPLIER SERVICES', percentage: 2 } }));
  const documents = prepareReportDocuments(organization, invoices, expenses, 2026, quarter);
  return { organization, invoices, expenses, documents, prep: id => documents.find(doc => doc.id === id) };
}
const verified = { rdoCode: '039', citizenship: 'FILIPINO', dateOfBirth: '1990-01-02', civilStatus: 'single', incomeTaxElection: 'graduated', reviewedAmounts: true, verifiedCredits: true,
  calendarYear: true, corporateRate: '25', commencementYear: '2020' };
const compute = (f, id, details = {}) => computeReportDocument(f.prep(id), { ...verified, ...details }, f.invoices, f.expenses);

test('quarterly forms follow classification, Q4 income returns are unavailable, and annual cards cover the full year', () => {
  assert.equal(fixture().prep('1701Q').supported, true);
  assert.equal(fixture().prep('1702Q').supported, false);
  assert.equal(fixture('corporation').prep('1702Q').supported, true);
  for (const classification of ['individual', 'corporation']) {
    const f = fixture(classification, 4);
    for (const id of ['1701Q', '1702Q']) assert.equal(f.prep(id).supported, false);
    assert.equal(f.prep('1701').annual, true);
    assert.equal(f.prep('1701').periodStart, '2026-01-01'); assert.equal(f.prep('1701').periodEnd, '2026-12-31');
    assert.equal(f.prep('QAP').periodLabel, 'Q4 2026 · October–December');
    assert.equal(f.prep('SALES').supported, true);
  }
});

test('1701Q uses cumulative income, graduated brackets, prior credits and whole-peso form rounding', () => {
  const f = fixture(); const result = compute(f, '1701Q');
  assert.equal(result.computed.taxableIncome, 2400000);
  assert.equal(result.computed.taxDue, 522500);
  assert.equal(result.computed.credits, 60000);
  assert.equal(result.computed.totalPayable, 462500);
  assert.equal(graduatedTax(400000, 2026), 22500);
  assert.equal(graduatedTax(400000, 2022), 30000);
  assert.equal(graduatedTax(8000000, 2026), 2202500);
  assert.equal(graduatedTax(-1, 2026), 0);
  const rounded = compute(f, '1701Q', { sales: '1000000.50', deductions: '200000.49' });
  assert.equal(rounded.values.sales, 1000001); assert.equal(rounded.values.deductions, 200000);
});

test('individual OSD deducts 40% of sales; corporate OSD deducts 40% of gross income after cost of sales', () => {
  const individual = compute(fixture('individual', 1), '1701Q', { deductionMethod: 'osd' });
  assert.equal(individual.computed.deduction, 400000); assert.equal(individual.computed.taxDue, 62500);
  assert.throws(() => compute(fixture('individual', 1), '1701Q', { deductionMethod: 'osd', costSales: 1 }), /not separately deductible/);
  const corporation = compute(fixture('corporation', 1), '1702Q', { deductionMethod: 'osd', costSales: 500000, grossIncomeQ1: 500000 });
  assert.equal(corporation.computed.deduction, 200000); assert.equal(corporation.computed.taxDue, 75000);
});

test('8% distinguishes pure business from mixed income and verifies eligibility before rounding', () => {
  const f = fixture('individual', 1);
  const pure = compute(f, '1701Q', { incomeTaxElection: 'eight_percent', eightPercentEligible: true });
  const mixed = compute(f, '1701Q', { incomeTaxElection: 'eight_percent', eightPercentEligible: true, mixedIncome: true });
  assert.equal(pure.computed.taxDue, 60000); assert.equal(mixed.computed.taxDue, 80000);
  assert.throws(() => compute(f, '1701Q', { incomeTaxElection: 'eight_percent', eightPercentEligible: false }), /8% requires/);
  assert.throws(() => compute(f, '1701Q', { incomeTaxElection: 'eight_percent', eightPercentEligible: true, sales: '3000000.01' }), /exceed/);
  const vat = fixture('individual', 1, { taxType: { code: 'VAT', percentage: 12 } });
  assert.throws(() => compute(vat, '1701Q', { incomeTaxElection: 'eight_percent', eightPercentEligible: true }), /non-VAT/);
});

test('domestic corporate rate, asset thresholds and MCIT commencement are explicitly verified', () => {
  const f = fixture('corporation');
  assert.equal(compute(f, '1702Q').computed.taxDue, 600000);
  assert.equal(compute(f, '1702Q', { corporateRate: '20', totalAssets: 100000000, eligibleSmallCorporation: true }).computed.taxDue, 480000);
  assert.throws(() => compute(f, '1702Q', { corporateRate: '20' }), /20% requires/);
  assert.throws(() => compute(f, '1702Q', { corporateRate: '20', totalAssets: '100000000.01', eligibleSmallCorporation: true }), /20% requires/);
  const q1 = fixture('corporation', 1);
  assert.equal(compute(q1, '1702Q', { deductions: 1000000 }).computed.mcit, 20000);
  assert.equal(compute(q1, '1702Q', { commencementYear: '2023', deductions: 1000000 }).computed.mcit, 0);
  assert.equal(compute(q1, '1702Q', { commencementYear: '2022', deductions: 1000000 }).computed.taxDue, 20000);
  assert.throws(() => compute(q1, '1702Q', { deductions: 1000000, excessMcitCredit: 100 }), /regular tax prevails/);
  assert.throws(() => compute(q1, '1702Q', { costSales: 500000 }), /MCIT gross income must match/);
  assert.throws(() => compute(f, '1702Q', { calendarYear: false }), /calendar taxable year/);
});

test('supplier EWT is remitted on 1601-EQ and does not become an incoming income-tax credit', () => {
  const f = fixture();
  const result = compute(f, '1601EQ', { firstMonthRemittance: 1000, secondMonthRemittance: 500, overRemittance: 250 });
  assert.equal(result.computed.taxDue, 4000); assert.equal(result.computed.credits, 1750); assert.equal(result.computed.totalPayable, 2250);
  assert.equal(compute(f, '1701Q').values.currentWithholding, 20000);
  const certificate = compute(f, '2307');
  assert.deepEqual(certificate.computed.months, [0, 0, 200000]); assert.equal(certificate.computed.taxDue, 4000);
  assert.equal(certificate.values.payeeTin, '98765432100123');
  assert.throws(() => compute(f, '1601EQ', { atc_ewt: 'EWT2' }), /actual five-character/);
  assert.throws(() => compute(f, '1601EQ', { previousPayment: 100 }), /amended/);
});

test('document validation rejects malformed amounts, incomplete details and unverified claims', () => {
  const f = fixture();
  for (const details of [{ reviewedAmounts: false }, { verifiedCredits: false }, { dateOfBirth: '1990-02-31' }, { sales: -1 }, { sales: 'NaN' }, { deductions: 1.001 }, { rdoCode: '39' }, { tin: '123' }, { otherIncome: 100 }, { otherCredits: 100 }, { civilStatus: 'estate_trust' }]) assert.throws(() => compute(f, '1701Q', details));
  assert.throws(() => compute(fixture('individual', 1), '1701Q', { priorIncome: 1 }), /Q1 cannot/);
  assert.throws(() => compute(f, '2307', { payeeAddress: '' }), /supplier registered/);
  const broken = fixture(); broken.expenses[2].withHoldingTaxAmount = 3000;
  assert.throws(() => compute(broken, '1601EQ'), /does not match/);
});

test('foreign-currency and exempt income returns remain unavailable; VAT attachment applicability is separate', () => {
  assert.equal(fixture('corporation', 3, { currency: 'USD' }).prep('1702Q').supported, false);
  assert.equal(fixture('corporation', 3, { isIncomeTaxExempt: true }).prep('1702Q').supported, false);
  assert.equal(fixture().prep('SLS').supported, false);
  assert.equal(fixture('corporation', 3, { taxType: { code: 'VAT', percentage: 12 } }).prep('SLS').supported, true);
});

test('quarterly income revision includes prior quarters but excludes future-quarter changes', () => {
  const f = fixture('individual', 1), before = f.prep('1701Q').sourceRevision;
  f.invoices[2].taxableAmount++;
  assert.equal(prepareReportDocuments(f.organization, f.invoices, f.expenses, 2026, 1).find(d => d.id === '1701Q').sourceRevision, before);
  const q3 = fixture(); q3.invoices[0].taxableAmount++;
  assert.notEqual(prepareReportDocuments(q3.organization, q3.invoices, q3.expenses, 2026, 3).find(d => d.id === '1701Q').sourceRevision, q3.prep('1701Q').sourceRevision);
});

function overlay(pdf, pageIndex) {
  const array = pdf.getPage(pageIndex).node.Contents();
  return Buffer.from(decodePDFRawStream(pdf.context.lookup(array.get(array.size() - 1))).decode()).toString();
}

test('both pages of 2550Q and 2551Q position all 14 TIN digits in their measured cells', async () => {
  const expected = {
    VAT: [[240.35, 254.45, 268.58, 297.25, 311.55, 325.73, 354.27, 368.53, 382.80, 411.73, 425.93, 440.08, 454.28, 468.45], [29.5, 43.25, 57.35, 71.46, 85.575, 99.62, 113.67, 127.775, 141.88, 155.98, 170.13, 184.28, 198.38, 212.515]],
    PT: [[228, 242.1, 256.2, 284.75, 298.85, 313.01, 341.59, 355.63, 369.85, 398.35, 412.45, 426.67, 440.83, 455], [30.48, 44.28, 58.45, 72.68, 86.84, 101, 115.22, 129.38, 143.54, 157.7, 171.86, 186.08, 200.255, 214.43]],
  };
  for (const code of ['VAT', 'PT']) {
    const f = fixture('corporation', 3, { taxType: { code, percentage: code === 'VAT' ? 12 : 3 } });
    const prep = prepareTaxReturn(f.organization, [], [], 2026, 3);
    const pdf = await PDFDocument.load(await renderTaxReturnPdf({ ...computeTaxReturn(prep, { rdoCode: '039', taxpayerSize: 'small' }), periodStart: '2026-07-01', periodEnd: '2026-09-30' }));
    for (const pageIndex of [0, 1]) {
      const top = code === 'VAT' ? [171.4, 92.2][pageIndex] : [163.1, 111.2][pageIndex];
      const y = pdf.getPage(pageIndex).getHeight() - top - 10;
      const digits = [...overlay(pdf, pageIndex).matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n<([A-F0-9]+)> Tj/g)].filter(match => Math.abs(Number(match[2]) - y) < .001 && /^[0-9]$/.test(Buffer.from(match[3], 'hex').toString()));
      assert.equal(digits.map(match => Buffer.from(match[3], 'hex').toString()).join(''), '12345678901234');
      digits.forEach((digit, i) => assert.ok(Math.abs(Number(digit[1]) + 3 - expected[code][pageIndex][i]) < .01));
      if (code === 'VAT') {
        const whiteRectangles = [...overlay(pdf, pageIndex).matchAll(/1 1 1 rg[\s\S]*?1 0 0 1 ([\d.]+) ([\d.]+) cm[\s\S]*?0 0 m\n0 ([\d.]+) l\n11 [\d.]+ l\n11 0 l\nh\nf/g)];
        assert.equal(whiteRectangles.length, 5, 'replace branch glyphs individually without erasing the grid');
        for (const rectangle of whiteRectangles) {
          const bottom = pdf.getPage(pageIndex).getHeight() - Number(rectangle[2]);
          const top = bottom - Number(rectangle[3]);
          assert.ok(top > [169.43, 90.6][pageIndex] && bottom < [186.03, 106.7][pageIndex], 'retain the top and bottom cell borders');
        }
      }
    }
  }
});

test('official returns retain their original pages and schedules paginate with repeated period labels', async () => {
  for (const id of ['1701Q', '1702Q', '1601EQ', '2307']) {
    const f = fixture(id === '1702Q' ? 'corporation' : 'individual');
    const pdf = await PDFDocument.load(await renderReportDocumentPdf(compute(f, id)));
    assert.equal(pdf.getPageCount(), id === '1702Q' ? 3 : 2);
    assert.match(pdf.getTitle(), /Q3 2026/);
    assert.deepEqual(pdf.getPage(0).getSize(), { width: 612, height: 936 });
  }
  for (const id of ['SAWT', 'QAP', 'SALES', 'EXPENSES']) {
    const f = fixture();
    const pdf = await PDFDocument.load(await renderReportDocumentPdf(compute(f, id)));
    assert.equal(pdf.getPageCount(), 1); assert.match(pdf.getTitle(), /Q3 2026/);
  }
  const f = fixture(); f.invoices = Array.from({ length: 160 }, (_, i) => ({ ...f.invoices[2], id: `invoice-${i}`, invoiceNumber: `INV-${i}` }));
  const prep = prepareReportDocuments(f.organization, f.invoices, [], 2026, 3).find(d => d.id === 'SALES');
  const pdf = await PDFDocument.load(await renderReportDocumentPdf(computeReportDocument(prep, {}, f.invoices, [])));
  assert.ok(pdf.getPageCount() > 1);
});

function controllerFixture(privileged = false) {
  const f = fixture('corporation'); const queries = [];
  const records = (rows, key, options) => rows.filter(row => row[key] >= options.where[key][Op.between][0] && row[key] <= options.where[key][Op.between][1]).map(row => ({ toJSON: () => row }));
  const models = {
    Organization: { findByPk: async id => { queries.push({ organization: id }); return f.organization; } },
    TaxType: {}, WithholdingTaxType: {}, Vendor: {}, Order: {}, Customer: {},
    SalesInvoice: { findOne: async options => { queries.push(options); return {}; }, findAll: async options => { queries.push(options); return records(f.invoices, 'issueDate', options); } },
    Expense: { findOne: async options => { queries.push(options); return {}; }, findAll: async options => { queries.push(options); return options.group ? [] : records(f.expenses, 'expenseDate', options); } },
  };
  const filename = path.join(__dirname, '../src/controllers/reports-controller.js'), actualRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer,
    require: name => name === '../sequelize' ? { getModels: () => models } : name === '../services/email-service' ? {} : actualRequire(name) });
  const req = { query: { organizationId: 'org-b', year: 2026, quarter: 3 }, body: { documentId: '1702Q', year: 2026, quarter: 3, details: verified, sourceRevision: f.prep('1702Q').sourceRevision },
    auth: { user: { organizationId: 'org-a' }, roleCodes: privileged ? ['superuser'] : [] } };
  const res = { headers: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; return this; } };
  return { controller: module.exports, req, res, queries, f };
}

test('new PDF endpoint keeps tenant scope, loads prior-quarter records and rejects stale sources', async () => {
  const f = controllerFixture(); await f.controller.generateBirReportDocumentPdf(f.req, f.res, error => { throw error; });
  assert.equal(f.res.statusCode, 200); assert.equal(f.queries[0].organization, 'org-a');
  assert.equal(f.res.headers['Content-Type'], 'application/pdf'); assert.equal(f.res.headers['Cache-Control'], 'private, no-store');
  assert.match(f.res.headers['Content-Disposition'], /1702Q-2026-q3/);
  assert.ok(f.queries.some(query => query.where?.issueDate?.[Op.between]?.[0] === '2026-01-01'));
  for (const query of f.queries.filter(query => query.where)) assert.equal(query.where.organizationId, 'org-a');
  const stale = controllerFixture(); stale.req.body.sourceRevision = 'old';
  await stale.controller.generateBirReportDocumentPdf(stale.req, stale.res, error => { throw error; });
  assert.equal(stale.res.statusCode, 400); assert.match(stale.res.body.message, /changed/);
});

test('new endpoint validates period, document type and explicit privileged organization selection', async () => {
  const invalid = controllerFixture(); invalid.req.body.quarter = 4;
  await invalid.controller.generateBirReportDocumentPdf(invalid.req, invalid.res, error => { throw error; });
  assert.equal(invalid.res.statusCode, 400);
  const unknown = controllerFixture(); unknown.req.body.documentId = 'arbitrary-file';
  await unknown.controller.generateBirReportDocumentPdf(unknown.req, unknown.res, error => { throw error; });
  assert.equal(unknown.res.statusCode, 400); assert.match(unknown.res.body.message, /supported report/);
  const scoped = controllerFixture(true); scoped.req.query = {};
  await scoped.controller.generateBirReportDocumentPdf(scoped.req, scoped.res, error => { throw error; });
  assert.equal(scoped.res.statusCode, 400); assert.equal(scoped.queries.length, 0);
});
