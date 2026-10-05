const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject } = require('rxjs');

function setup() {
  const requests = [];
  const api = { list(url) {
    const stream = new Subject();
    requests.push({ url, stream });
    return stream;
  } };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/reports-page/reports-page.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URLSearchParams,
    document: { getElementById: () => ({ scrollIntoView() {} }) },
    require(name) {
      if (name === '@angular/core') return {
        Component: () => value => value, computed: fn => fn,
        signal(value) { const read = () => value; read.set = next => { value = next; }; return read; },
      };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const page = new module.exports.ReportsPageComponent(api,
    { currentUser: () => ({ roleCodes: [], organizationId: 'org-a' }), hasPermission: () => true }, {},
    { getActiveOrganizationId: () => 'org-a' });
  page.persistTablePreferences = () => {};
  page.loadOrganizationTaxInfo = () => {};
  page.loadBirFilingSummary = () => {};
  page.selectedYear.set(2026);
  page.selectedQuarter.set(2);
  return { page, requests };
}

test('filing summaries cancel earlier quarter requests and discard stale PDF preparation', () => {
  const { page, requests } = setup();
  delete page.loadBirFilingSummary;
  page.api.getFresh = url => {
    const stream = new Subject(); requests.push({ url, stream }); return stream;
  };
  page.loadBirFilingSummary();
  page.selectedQuarter.set(3); page.loadBirFilingSummary();
  assert.equal(requests[0].stream.observed, false);
  requests[0].stream.next({ data: { year: 2026, quarter: 2, taxReturn: { form: '2551Q' } } });
  assert.equal(page.filingSummary(), null);
  requests[1].stream.next({ data: { year: 2026, quarter: 3, taxReturn: { form: '2550Q' } } });
  assert.equal(page.filingSummary().quarter, 3);
  page.loadBirFilingSummary(); assert.equal(page.filingSummary(), null);
  page.ngOnDestroy(); assert.equal(requests[2].stream.observed, false);
});

for (const [type, load, rows, latest, loading] of [
  ['sales', 'loadSalesReports', 'salesRows', 'latestSalesReport', 'loadingSales'],
  ['expense', 'loadExpenseReports', 'expenseRows', 'latestExpenseReport', 'loadingExpenses'],
]) {
  const dataset = [2025, 2026].flatMap(year => [1, 2, 3, 4].map(quarter => ({
    id: `${year}-q${quarter}`, organizationId: 'org-a', year, quarter,
  })));
  function respond(request) {
    const params = new URL(request.url, 'http://test').searchParams;
    const data = dataset.filter(row => String(row.year) === params.get('year'));
    request.stream.next({ data, meta: { total: data.length, totalPages: 1, page: 1, limit: 20 } });
    request.stream.complete();
  }

  test(`${type}: selected year filters records and totals while retaining every quarter`, () => {
    const { page, requests } = setup();
    page[load]();
    const params = new URL(requests[0].url, 'http://test').searchParams;
    assert.equal(params.get('year'), '2026');
    assert.equal(params.get('organizationId'), 'org-a');
    assert.equal(params.has('quarter'), false);
    respond(requests[0]);
    assert.equal(page[rows]().length, 4);
    assert.ok(page[rows]().every(row => row.year === 2026));
    assert.equal(page[`${type}Total`], 4);
    assert.equal(page[latest]().quarter, 2);
    page.selectedYear.set(2025);
    page[load]();
    assert.equal(page[rows]().length, 0);
    assert.equal(page[latest](), null);
    respond(requests[1]);
    assert.ok(page[rows]().every(row => row.year === 2025));
    assert.equal(page[latest]().year, 2025);
  });

  test(`${type}: old requests cannot overwrite a newly selected year or its loading state`, () => {
    const { page, requests } = setup();
    page[load]();
    page.selectedYear.set(2025);
    page[load]();
    assert.equal(requests[0].stream.observed, false);
    respond(requests[0]);
    assert.equal(page[loading](), true);
    assert.equal(page[rows]().length, 0);
    respond(requests[1]);
    assert.equal(page[loading](), false);
    assert.ok(page[rows]().every(row => row.year === 2025));
    page[load]();
    page.ngOnDestroy();
    assert.equal(requests[2].stream.observed, false);
  });
}

test('year changes reset both pages and pagination keeps the selected year', () => {
  const { page, requests } = setup();
  page.salesPage = 3;
  page.expensePage = 4;
  page.selectedYear.set(2025);
  page.onFilterChange();
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const params = new URL(request.url, 'http://test').searchParams;
    assert.equal(params.get('page'), '1');
    assert.equal(params.get('year'), '2025');
    request.stream.next({ data: [], meta: { total: 25, totalPages: 3, page: 1, limit: 10 } });
    request.stream.complete();
  }
  page.goToSalesPage(2);
  page.goToExpensePage(2);
  for (const request of requests.slice(2)) {
    const params = new URL(request.url, 'http://test').searchParams;
    assert.equal(params.get('page'), '2');
    assert.equal(params.get('year'), '2025');
  }
  page.ngOnDestroy();
});

test('saved-report PDF actions prepare the exact quarter in the selected organization', () => {
  const { page, requests } = setup();
  let summaries = 0;
  page.loadBirFilingSummary = () => { summaries++; };
  page.prepareQuarterPdf({ organizationId: 'org-a', year: 2025, quarter: 4 }, 'EXPENSES');
  assert.equal(page.selectedYear(), 2025);
  assert.equal(page.selectedQuarter(), 4);
  assert.equal(page.initialDocumentId(), 'EXPENSES');
  assert.equal(summaries, 1);
  assert.equal(requests.length, 2);
  page.prepareQuarterPdf({ organizationId: 'org-b', year: 2026, quarter: 2 }, 'SALES');
  assert.equal(page.selectedYear(), 2025);
  assert.equal(page.initialDocumentId(), 'EXPENSES');
  assert.equal(summaries, 1);
  page.auth.hasPermission = () => false;
  assert.equal(page.canPrepareQuarterPdf({ organizationId: 'org-a' }), false);
  page.ngOnDestroy();
});

test('PDF generation refreshes the saved download table without changing the selected period', () => {
  const { page } = setup(); page.onPdfSaved(); page.onPdfSaved();
  assert.equal(page.pdfArchiveRefresh(), 2); assert.equal(page.selectedYear(), 2026); assert.equal(page.selectedQuarter(), 2);
});
