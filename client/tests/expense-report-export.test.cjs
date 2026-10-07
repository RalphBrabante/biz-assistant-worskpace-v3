const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { unzipSync, strFromU8 } = require('fflate');
const { Subject } = require('rxjs');
function load(relative, dependency, globals = {}) {
  const filename = path.join(__dirname, '../src/app', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const module = { exports: {} };
  const resolve = name => name.startsWith('.') ? load(path.join(path.dirname(relative), name + '.ts'), undefined, globals) : require(name);
  vm.runInNewContext(source, { module, exports: module.exports, require: dependency || resolve, URLSearchParams, Error, ...globals });
  return module.exports;
}
const { buildExpenseReportWorkbook } = load('core/expense-report-export.ts');
const { buildSalesReportWorkbook } = load('core/sales-report-export.ts');
const { splitBirTin } = load('core/bir-alphalist-export.ts');
const report = { id: 'report-a', year: 2026, quarter: 3, periodStart: '2026-07-01', periodEnd: '2026-09-30', currency: 'PHP', expenseCount: 1, organization: { id: 'org-a', name: 'Example', legalName: 'EXAMPLE INC', taxId: '123-456-789-0000', rdoCode: '039', taxpayerClassification: 'corporation' } };
const expense = { id: 'e1', expenseNumber: '000001', expenseDate: '2026-09-23', currency: 'PHP', status: 'approved', amount: '112.00', taxableAmount: '100.00', taxAmount: '12.00', receiptVatAmount: '12.00', withholdingTaxBase: '100.00', withHoldingTaxAmount: '2.00', totalAmount: '110.00', vendor: { id: 'vendor-a', name: 'ACME', legalName: 'ACME INC', taxId: '001-002-003-000' }, withholdingTaxType: { id: 'ewt', code: 'WC158', name: 'Income payments for goods', percentage: '2.00' }, description: '=SUM(A1:A5) & <text>' };
function sheets(bytes) { const archive = unzipSync(bytes); return { archive, xml: n => strFromU8(archive[`xl/worksheets/sheet${n}.xml`]) }; }
function cell(xml, ref) { return xml.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`))?.[0] || ''; }
test('expense workbook exports all rows with typed amounts, dates, TINs and safe text', () => {
  const data = Array.from({ length: 300 }, (_, i) => ({ ...expense, id: `e${i}`, expenseNumber: String(i).padStart(6, '0') }));
  const result = sheets(buildExpenseReportWorkbook(report, data));
  assert.equal((result.xml(2).match(/<row /g) || []).length, 301);
  assert.match(result.xml(2), /autoFilter ref="A1:Y301"/);
  assert.match(cell(result.xml(2), 'A2'), /t="inlineStr".*000000/);
  assert.match(cell(result.xml(2), 'E2'), /t="inlineStr".*001-002-003-000/);
  assert.match(cell(result.xml(2), 'B2'), /s="3" t="n"/);
  assert.match(cell(result.xml(2), 'M2'), /s="2" t="n"><v>112<\/v>/);
  assert.match(cell(result.xml(2), 'S2'), /<v>2<\/v>/);
  assert.match(cell(result.xml(2), 'Y2'), /=SUM\(A1:A5\) &amp; &lt;text&gt;/);
  assert.doesNotMatch(result.xml(2), /<f[ >]/);
  assert.match(cell(result.xml(1), 'B11'), /<v>300<\/v>/);
  assert.match(strFromU8(result.archive['xl/workbook.xml']), /name="QAP Details"/);
});
test('expense currency totals never mix PHP and USD and optional values stay blank', () => {
  const data = [expense, { ...expense, id: 'e2', currency: 'USD', amount: '0.10', withholdingTaxBase: null }, { ...expense, id: 'e3', currency: 'USD', amount: '0.20', receiptVatAmount: null }];
  const result = sheets(buildExpenseReportWorkbook(report, data));
  assert.match(cell(result.xml(1), 'A15'), /PHP/); assert.match(cell(result.xml(1), 'C15'), /<v>112<\/v>/);
  assert.match(cell(result.xml(1), 'A16'), /USD/); assert.match(cell(result.xml(1), 'C16'), /<v>0.3<\/v>/);
  assert.match(cell(result.xml(2), 'R3'), /t="inlineStr".*<t xml:space="preserve"><\/t>/);
  assert.match(result.xml(5), /foreign amounts have not been converted/);
  assert.match(cell(result.xml(3), 'B10'), /<v>2<\/v>/);
});
test('QAP field order matches the BIR 1601EQ Schedule 1 detail structure', () => {
  const result = sheets(buildExpenseReportWorkbook(report, [expense]));
  const xml = result.xml(4);
  ['SCHEDULE_NUM', 'FTYPE_CODE', 'SEQ_NUM', 'TIN_PAYEE', 'BRANCH_CODE_PAYEE', 'REGISTERED_NAME_PAYEE', 'LAST_NAME_PAYEE', 'FIRST_NAME_PAYEE', 'MIDDLE_NAME_PAYEE', 'RETRN_PERIOD', 'ATC_CODE', 'TAX_RATE', 'INCOME_PAYMENT', 'ACTUAL_AMT_WTHLD'].forEach((header, i) => assert.match(cell(xml, `${String.fromCharCode(65 + i)}1`), new RegExp(header)));
  assert.match(cell(xml, 'A2'), /D1/); assert.match(cell(xml, 'B2'), /1601EQ/);
  assert.match(cell(xml, 'D2'), /t="inlineStr".*001002003/); assert.match(cell(xml, 'E2'), /t="inlineStr".*0000/);
  assert.match(cell(xml, 'J2'), /09\/2026/); assert.match(cell(xml, 'K2'), /WC158/);
  assert.match(cell(xml, 'M2'), /<v>100<\/v>/); assert.match(cell(xml, 'N2'), /<v>2<\/v>/);
  assert.match(result.xml(5), /Confirm taxpayer type/);
  assert.match(result.xml(3), /not a RELIEF import/);
});
test('legacy EWT base uses gross less supplier VAT, including the exempt portion', () => {
  const xml = sheets(buildExpenseReportWorkbook(report, [{ ...expense, amount: 212, taxableAmount: 100, vatExemptAmount: 100, withholdingTaxBase: null }])).xml(4);
  assert.match(cell(xml, 'M2'), /<v>200<\/v>/);
});
test('TIN normalization preserves leading zeros and never guesses or discards branches', () => {
  assert.equal(splitBirTin('001-002-003').tin, '001002003'); assert.equal(splitBirTin('001-002-003').branch, '');
  assert.equal(splitBirTin('001-002-003-001').branch, '0001');
  assert.equal(splitBirTin('00100200301234').branch, '1234');
  for (const invalid of ['001002003A000', '00100200312345', '123', '001002003000000']) assert.equal(splitBirTin(invalid).valid, false);
});
test('SAWT uses the frozen invoice buyer and correct detail field order without a fabricated individual name', () => {
  const invoice = { id: 'i1', currency: 'PHP', taxableAmount: 100, withHoldingTaxAmount: 2, issueDate: '2026-09-23', status: 'issued', invoiceDocument: { buyer: { name: 'ISSUED BUYER', taxId: '0010020030000' } }, order: { id: 'o1', customer: { id: 'c1', name: 'Changed customer', taxId: '9998887770000', type: 'individual' } }, withholdingTaxType: expense.withholdingTaxType };
  const result = sheets(buildSalesReportWorkbook(report, [invoice])); const xml = result.xml(4);
  assert.match(cell(xml, 'A2'), /DSAWT/); assert.match(cell(xml, 'B2'), /D1702Q/);
  assert.match(cell(xml, 'D2'), /001002003/); assert.doesNotMatch(xml, /999888777/);
  assert.match(cell(xml, 'F2'), /<t xml:space="preserve"><\/t>/);
  assert.match(cell(xml, 'G2'), /<t xml:space="preserve"><\/t>/);
  assert.match(cell(xml, 'K2'), /Income payments for goods/); assert.match(cell(xml, 'L2'), /WC158/);
  assert.match(cell(xml, 'N2'), /<v>100<\/v>/); assert.match(cell(xml, 'O2'), /<v>2<\/v>/);
  assert.match(result.xml(5), /ISSUED BUYER/);
  const q4 = sheets(buildSalesReportWorkbook({ ...report, quarter: 4 }, [invoice])); assert.match(q4.xml(5), /Q4 alone is not a complete annual attachment/);
});
test('empty exports remain valid, internal ATCs and missing tax data require review, invalid amounts fail', () => {
  const empty = sheets(buildExpenseReportWorkbook(report, [])); assert.match(empty.xml(2), /A1:Y1/); assert.match(empty.xml(4), /A1:N1/);
  const result = sheets(buildExpenseReportWorkbook(report, [{ ...expense, vendor: undefined, vendorTaxId: undefined, withholdingTaxType: { id: 'internal', code: 'EWT2' } }]));
  assert.match(result.xml(5), /Missing or invalid TIN/); assert.match(result.xml(5), /not an internal tax code/); assert.match(result.xml(5), /Confirm the applicable withholding rate/);
  assert.throws(() => buildExpenseReportWorkbook(report, [{ ...expense, amount: 'broken' }]), /invalid amount/);
});

test('vendor address includes barangay, province and postal code, trims missing components and stays safe text', () => {
  const vendor = { ...expense.vendor, addressLine1: ' =SUM(A1:A5) & <street> ', addressLine2: ' Unit 2 ', barangay: 'San Antonio', city: 'San Pedro', state: 'Region IV-A', province: 'Laguna', postalCode: '0402', country: 'Philippines' };
  const result = sheets(buildExpenseReportWorkbook(report, [{ ...expense, vendor }, { ...expense, vendor: { city: ' Manila ', province: ' ' } }, { ...expense, vendor: undefined }]));
  assert.match(cell(result.xml(2), 'F1'), /Vendor Address/);
  assert.match(cell(result.xml(2), 'F2'), /s="4" t="inlineStr".*=SUM\(A1:A5\) &amp; &lt;street&gt;, Unit 2, San Antonio, San Pedro, Region IV-A, Laguna, 0402, Philippines/);
  assert.match(cell(result.xml(2), 'F3'), /<t xml:space="preserve">Manila<\/t>/);
  assert.match(cell(result.xml(2), 'F4'), /<t xml:space="preserve"><\/t>/);
  assert.doesNotMatch(result.xml(2), /<f[ >]/);
  assert.match(result.xml(2), /<row r="2" ht="\d+" customHeight="1">/);
});
function preview() {
  const requests = [], downloads = [], route = new Subject(); let fail = false;
  const deps = { ActivatedRoute: { paramMap: route }, ApiService: { getFresh(url) { const stream = new Subject(); requests.push({ url, stream }); return stream; } }, OrganizationContextService: { getActiveOrganizationId: () => 'org-a', shouldApplySuperuserScope: () => true } };
  const module = load('pages/report-preview-page/report-preview-page.component.ts', name => {
    if (name === '../../core/expense-report-export') return { downloadExpenseReport: (...args) => { if (fail) throw new Error('Download failed'); downloads.push(args); } };
    if (name === '@angular/core') return { Component: () => target => target, inject: key => deps[key], computed: fn => fn, signal(value) { const read = () => value; read.set = next => { value = next; }; return read; } };
    return new Proxy({}, { get: (_, key) => key });
  });
  const page = new module.ReportPreviewPageComponent(); page.ngOnInit();
  return { page, requests, downloads, route, fail: () => { fail = true; } };
}
test('expense preview uses a fresh scoped request and guards pending and duplicate downloads', async () => {
  const e = preview(); e.route.next({ get: () => report.id });
  assert.match(e.requests[0].url, /organizationId=org-a/); await e.page.exportExcel(); assert.equal(e.downloads.length, 0);
  e.requests[0].stream.next({ data: { report, expenses: [expense] } }); await Promise.all([e.page.exportExcel(), e.page.exportExcel()]);
  assert.equal(e.downloads.length, 1); assert.equal(e.downloads[0][0], report); assert.equal(e.downloads[0][1][0], expense);
  e.page.ngOnDestroy(); assert.equal(e.requests[0].stream.observed, false);
});
test('stale expense responses, missing IDs and load failures cannot export old records', async () => {
  const e = preview(); e.route.next({ get: () => 'old' }); e.route.next({ get: () => 'new' });
  assert.equal(e.requests[0].stream.observed, false); e.requests[0].stream.next({ data: { report, expenses: [expense] } }); assert.equal(e.page.report(), null);
  e.requests[1].stream.next({ data: { report, expenses: [expense] } }); e.route.next({ get: () => '' }); await e.page.exportExcel(); assert.equal(e.downloads.length, 0);
  e.route.next({ get: () => 'failed' }); e.requests[2].stream.error({ error: { message: 'Unavailable' } }); await e.page.exportExcel(); assert.equal(e.downloads.length, 0); assert.equal(e.page.error(), 'Unavailable');
  e.page.ngOnDestroy();
});
test('failed expense download is retryable and leaves the current report intact', async () => {
  const e = preview(); e.route.next({ get: () => report.id }); e.requests[0].stream.next({ data: { report, expenses: [expense] } }); e.fail();
  await e.page.exportExcel(); assert.equal(e.page.exportError(), 'Download failed'); assert.equal(e.page.exporting(), false); assert.equal(e.page.report(), report); e.page.ngOnDestroy();
});
