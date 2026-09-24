const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { unzipSync, strFromU8 } = require('fflate');
const { Subject } = require('rxjs');

function load(relative, requireDependency = require, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: requireDependency, URLSearchParams, ...globals });
  return module.exports;
}
const { buildSalesReportWorkbook } = load('core/sales-report-export.ts');
const report = { id: 'report-1', year: 2026, quarter: 3, periodStart: '2026-07-01', periodEnd: '2026-09-30', currency: 'PHP', generatedAt: '2026-09-24T00:00:00Z', invoiceCount: 1, totalAmount: 112, organization: { id: 'org-a', name: 'Example & Co' } };
const invoice = { id: 'invoice-1', invoiceNumber: '000001', issueDate: '2026-09-23', dueDate: '2026-10-23', status: 'issued', paymentStatus: 'partially_paid', currency: 'PHP', amount: '112.00', taxableAmount: '100.00', subtotalAmount: '100.00', taxAmount: '12.00', withHoldingTaxAmount: '2.00', discountAmount: '1.00', scPwdDiscount: '0.50', serviceCharge: '3.00', totalAmount: '111.50', order: { id: 'order-1', orderNumber: 'SO-1', customer: { id: 'customer-1', name: '=HYPERLINK("https://example.invalid") & <Client>', taxId: '001-002-003-000' } } };
function sheets(invoices) {
  const archive = unzipSync(buildSalesReportWorkbook(report, invoices, new Date('2026-09-24T01:02:03Z')));
  return { archive, summary: strFromU8(archive['xl/worksheets/sheet1.xml']), invoices: strFromU8(archive['xl/worksheets/sheet2.xml']) };
}
function cell(xml, ref) { return xml.match(new RegExp(`<c r="${ref}"[^>]*>[\\s\\S]*?</c>`))?.[0] || ''; }

test('workbook has summary and invoice sheets with Excel package relationships', () => {
  const result = sheets([invoice]);
  assert.ok(result.archive['[Content_Types].xml']);
  assert.ok(result.archive['_rels/.rels']);
  assert.match(strFromU8(result.archive['xl/workbook.xml']), /name="Summary"/);
  assert.match(strFromU8(result.archive['xl/workbook.xml']), /name="Invoices"/);
  assert.match(result.invoices, /autoFilter ref="A1:T2"/);
  assert.match(result.invoices, /state="frozen"/);
  assert.match(result.summary, /Example &amp; Co/);
  assert.match(result.summary, /2026 Q3/);
});

test('invoice amounts and dates are numeric, while TINs, references and formula-like text stay text', () => {
  const result = sheets([invoice]);
  assert.match(cell(result.invoices, 'A2'), /t="inlineStr".*000001/);
  assert.match(cell(result.invoices, 'F2'), /t="inlineStr".*001-002-003-000/);
  assert.match(cell(result.invoices, 'B2'), /s="3" t="n"/);
  assert.match(cell(result.invoices, 'J2'), /s="2" t="n"><v>112<\/v>/);
  assert.match(cell(result.invoices, 'N2'), /<v>2<\/v>/);
  assert.match(cell(result.invoices, 'R2'), /<v>111.5<\/v>/);
  assert.match(cell(result.invoices, 'E2'), /t="inlineStr".*=HYPERLINK\(&quot;/);
  assert.match(cell(result.invoices, 'E2'), /&amp; &lt;Client&gt;/);
  assert.doesNotMatch(result.invoices, /<f[ >]/);
});

test('exports all invoices beyond a table page or the old template capacity', () => {
  const data = Array.from({ length: 125 }, (_, i) => ({ ...invoice, id: `invoice-${i}`, invoiceNumber: `INV-${i}` }));
  const result = sheets(data);
  assert.equal((result.invoices.match(/<row /g) || []).length, 126);
  assert.match(result.invoices, /INV-124/);
  assert.match(cell(result.summary, 'B11'), /<v>125<\/v>/);
});

test('currency totals remain separate and are derived from the exported invoice values', () => {
  const result = sheets([invoice, { ...invoice, id: 'invoice-2', currency: 'USD', totalAmount: '0.10' }, { ...invoice, id: 'invoice-3', currency: 'USD', totalAmount: '0.20' }]);
  assert.match(cell(result.summary, 'A15'), /PHP/); assert.match(cell(result.summary, 'K15'), /<v>111.5<\/v>/);
  assert.match(cell(result.summary, 'A16'), /USD/); assert.match(cell(result.summary, 'B16'), /<v>2<\/v>/);
  assert.match(cell(result.summary, 'K16'), /<v>0.3<\/v>/);
  assert.match(result.summary, /Saved report snapshot/);
});

test('empty reports export a valid header-only invoice sheet and zero invoice count', () => {
  const result = sheets([]);
  assert.equal((result.invoices.match(/<row /g) || []).length, 1);
  assert.match(cell(result.summary, 'B11'), /<v>0<\/v>/);
  assert.match(result.invoices, /autoFilter ref="A1:T1"/);
});

test('missing customers and optional dates export safely; invalid amounts fail clearly', () => {
  const result = sheets([{ ...invoice, order: undefined, dueDate: undefined, notes: 'Text\u0000 with control character' }]);
  assert.match(cell(result.invoices, 'E2'), /<t xml:space="preserve"><\/t>/);
  assert.doesNotMatch(result.invoices, /\u0000/);
  assert.throws(() => sheets([{ ...invoice, taxAmount: 'not a number' }]), /invalid amount/);
});

function preview() {
  const requests = [], downloads = [], route = new Subject();
  let downloadError;
  const deps = {
    ActivatedRoute: { paramMap: route },
    ApiService: { getFresh(url) { const stream = new Subject(); requests.push({ url, stream }); return stream; } },
    OrganizationContextService: { getActiveOrganizationId: () => 'org-a', shouldApplySuperuserScope: () => true },
  };
  const module = load('pages/sales-report-preview-page/sales-report-preview-page.component.ts', name => {
    if (name === '../../core/sales-report-export') return { downloadSalesReport: (...args) => { if (downloadError) throw downloadError; downloads.push(args); } };
    if (name === '@angular/core') return { Component: () => target => target, inject: key => deps[key], signal(value) { const read = () => value; read.set = next => { value = next; }; return read; } };
    return new Proxy({}, { get: (_, key) => key });
  }, { Error });
  const page = new module.SalesReportPreviewPageComponent(); page.ngOnInit();
  return { page, requests, downloads, route, failDownload() { downloadError = new Error('Export failed'); } };
}

test('preview exports exactly the loaded report and all invoices, with duplicate-click guards', async () => {
  const e = preview(); e.route.next({ get: () => report.id });
  assert.match(e.requests[0].url, /organizationId=org-a/);
  await e.page.exportExcel(); assert.equal(e.downloads.length, 0);
  e.requests[0].stream.next({ data: { report, summary: {}, salesInvoices: [invoice] } });
  const first = e.page.exportExcel(); const duplicate = e.page.exportExcel(); await Promise.all([first, duplicate]);
  assert.equal(e.downloads.length, 1); assert.equal(e.downloads[0][0], report); assert.equal(e.downloads[0][1][0], invoice);
  assert.equal(e.page.exporting(), false); e.page.ngOnDestroy();
});

test('changing report cancels stale responses and a failed preview cannot export previous invoices', async () => {
  const e = preview(); e.route.next({ get: () => 'old-report' }); e.route.next({ get: () => 'new-report' });
  assert.equal(e.requests[0].stream.observers.length, 0);
  e.requests[0].stream.next({ data: { report, salesInvoices: [invoice] } });
  assert.equal(e.page.report(), null);
  e.requests[1].stream.error({ error: { message: 'Report unavailable' } });
  await e.page.exportExcel(); assert.equal(e.downloads.length, 0);
  assert.equal(e.page.error(), 'Report unavailable'); e.page.ngOnDestroy();
});

test('download failures show a retryable error and leave the preview intact', async () => {
  const e = preview(); e.route.next({ get: () => report.id });
  e.requests[0].stream.next({ data: { report, summary: {}, salesInvoices: [invoice] } }); e.failDownload();
  await e.page.exportExcel(); assert.equal(e.page.exportError(), 'Export failed');
  assert.equal(e.page.exporting(), false); assert.equal(e.page.report(), report); e.page.ngOnDestroy();
});
