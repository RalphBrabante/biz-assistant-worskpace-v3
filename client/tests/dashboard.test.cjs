const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function setup({ permissions = ['*'], organization = 'org-a', fail = '', deferred = false, deferredActions = false } = {}) {
  const requests = [], pending = [], actionPending = [];
  const summary = { year: 2026, currency: 'PHP', totalSales: 780, totalExpenses: 1560, months: Array.from({length: 12}, (_, i) => ({month: i + 1, monthName: `M${i + 1}`, sales: (i + 1) * 10, expenses: (i + 1) * 20})) };
  const api = {
    get(url) {
      requests.push(url);
      if (url.includes('action-center')) {
        if (deferredActions) { const stream = new rx.Subject(); actionPending.push(stream); return stream; }
        if (fail && url.includes(fail)) return rx.throwError(() => new Error('offline'));
        const params = new URL(url, 'http://test').searchParams;
        return rx.of({data: {page: Number(params.get('page')), pageSize: 5, total: 6, rows: [{id: 'action-1', reference: 'INV-1', currency: 'PHP', totalAmount: 500, daysOverdue: 3}]}});
      }
      if (url.includes('monthly-summary')) {
        if (deferred) { const stream = new rx.Subject(); pending.push(stream); return stream; }
        return rx.of({data: summary});
      }
      return rx.of({data: {services: {mysql: true}}});
    },
    list(url) {
      requests.push(url);
      if (fail && url.includes(fail)) return rx.throwError(() => new Error('offline'));
      const isInvoice = url.includes('sales-invoices');
      return rx.of({data: url.includes('limit=6') ? [{id: isInvoice ? 'invoice-1' : 'expense-1', invoiceNumber: 'INV-001', expenseNumber: 'EXP-001', createdAt: isInvoice ? '2026-08-10' : '2026-08-11', currency: isInvoice ? 'USD' : 'PHP', totalAmount: 500, status: 'paid', vendor: {name: 'Vendor'}, order: {customer: {name: 'Customer'}}}] : [], meta: {total: 3}});
    }
  };
  const dependencies = {
    api, auth: {currentUser: () => ({roleCodes: ['superuser'], organizationId: 'home-org', currency: 'USD'}), hasPermission: p => permissions.includes('*') || permissions.includes(p)},
    scope: {getActiveOrganizationId: () => organization, shouldApplySuperuserScope: () => Boolean(organization), requestSelection() {}}, zone: {runOutsideAngular: fn => fn()},
  };
  const core = {Component: () => v => v, ViewChild: () => () => {}, NgZone: 'zone', inject: key => dependencies[key]};
  const mocks = {'@angular/core': core, '@angular/common': {}, '@angular/forms': {}, '@angular/router': {}, 'rxjs': {...rx, forkJoin: sources => rx.forkJoin({...sources})}, 'chart.js': {Chart: class { static register() {} }, registerables: []}, '../../core/api.service': {ApiService: 'api'}, '../../core/auth.service': {AuthService: 'auth'}, '../../core/organization-context.service': {OrganizationContextService: 'scope'}};
  const source = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/app/pages/dashboard-page/dashboard-page.component.ts'), 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(source, {module, exports: module.exports, require: name => {if (!(name in mocks)) throw new Error(name); return mocks[name];}, URLSearchParams, Date, Intl});
  const page = new module.exports.DashboardPageComponent();
  let rendered;
  page.renderChart = (...values) => {rendered = values;};
  return {page, requests, pending, actionPending, summary, rendered: () => rendered};
}

test('quarterly figures use the complete monthly summary without fetching capped lists', () => {
  const e = setup(); e.page.refresh(); const before = e.requests.length; e.page.setChartView('quarterly');
  assert.deepEqual(Array.from(e.rendered()[1]), [60, 150, 240, 330]);
  assert.deepEqual(Array.from(e.rendered()[2]), [120, 300, 480, 660]);
  assert.equal(e.requests.length, before); assert.equal(e.page.yearlyExpenseTotal, 1560); assert.equal(e.page.orgCurrency, 'PHP');
});
test('all business requests explicitly use the selected organization, not the user home organization', () => {
  const e = setup(); e.page.refresh();
  for (const url of e.requests.filter(url => url !== '/api/v1')) assert.equal(new URL(url, 'http://test').searchParams.get('organizationId'), 'org-a', url);
  assert.equal(e.page.recentActivity[0].id, 'expense-1'); assert.equal(e.page.recentActivity[1].currency, 'USD');
});
test('restricted users neither request nor see unauthorized financial records and actions', () => {
  const e = setup({permissions: ['orders.read']}); e.page.refresh();
  assert.equal(e.requests.some(url => /expenses|invoices|monthly-summary/.test(url)), false);
  assert.equal(e.page.workQueue.length, 1); assert.equal(e.page.quickLinks.length, 0); assert.equal(e.page.metricCards.length, 1);
});
test('all-organizations view does not combine financial currencies or fetch locked financial lists', () => {
  const e = setup({organization: ''}); e.page.refresh();
  assert.equal(e.page.canShowFinancials, false); assert.equal(e.requests.some(url => /monthly-summary|limit=6|status=overdue|status=approved|status=submitted/.test(url)), false);
  assert.equal(e.page.recentActivity.length, 0);
});
test('failed counts remain unavailable and partial recent records have an explicit warning', () => {
  const e = setup({fail: '/expenses'}); e.page.refresh();
  assert.equal(e.page.workQueue.find(row => row.status === 'approved').count, null);
  assert.match(e.page.activityError, /could not be loaded/); assert.equal(e.page.recentActivity.length, 1);
});
test('changing years cancels stale financial responses, and destruction cancels pending work', () => {
  const e = setup({deferred: true}); e.page.refresh(); e.page.onYearChange('2025');
  assert.equal(e.pending[0].observers.length, 0);
  e.pending[0].next({data: e.summary}); assert.equal(e.page.financialReady, false);
  e.pending[1].next({data: {...e.summary, year: 2025, totalSales: 42}}); assert.equal(e.page.yearlySalesTotal, 42);
  e.page.onYearChange('2024'); e.page.ngOnDestroy(); assert.equal(e.pending[2].observers.length, 0);
});
test('a financial failure hides stale totals instead of showing the previous year as current', () => {
  const e = setup({deferred: true}); e.page.refresh(); e.pending[0].next({data: e.summary});
  assert.equal(e.page.financialReady, true); e.page.onYearChange('2025'); e.pending[1].error(new Error('offline'));
  assert.equal(e.page.financialReady, false); assert.match(e.page.chartError, /could not be loaded/);
});

test('Action Center requests only readable queues and paginates within the selected organization', () => {
  const e = setup({permissions: ['sales_invoices.read']}); e.page.refresh();
  assert.equal(e.page.visibleActionQueues.length, 1);
  const queue = e.page.visibleActionQueues[0];
  assert.equal(queue.data.total, 6);
  e.page.loadActions(queue, 2);
  const params = new URL(e.requests.at(-1), 'http://test').searchParams;
  assert.equal(params.get('kind'), 'invoices'); assert.equal(params.get('page'), '2');
  assert.equal(params.get('organizationId'), 'org-a'); assert.match(params.get('today'), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(queue.data.page, 2);
  const global = setup({organization: ''}); global.page.refresh();
  assert.equal(global.requests.some(url => url.includes('action-center')), false);
});

test('Action Center failures are distinct from empty queues and do not hide the other queue', () => {
  const e = setup({fail: 'kind=invoices'}); e.page.refresh();
  assert.match(e.page.actionQueues[0].error, /could not be loaded/);
  assert.equal(e.page.actionQueues[0].data, null);
  assert.equal(e.page.actionQueues[1].data.total, 6);
});

test('refresh and destruction cancel pending action requests', () => {
  const e = setup({deferredActions: true}); e.page.refresh(); e.page.refresh();
  assert.equal(e.actionPending[0].observers.length, 0); assert.equal(e.actionPending[1].observers.length, 0);
  e.page.ngOnDestroy(); assert.equal(e.actionPending[2].observers.length, 0); assert.equal(e.actionPending[3].observers.length, 0);
});

test('an emptied last page returns to the last available action page', () => {
  const e = setup({deferredActions: true, permissions: ['expenses.read']}); e.page.refresh();
  const queue = e.page.visibleActionQueues[0];
  e.page.loadActions(queue, 2);
  e.actionPending[1].next({data: {page: 2, pageSize: 5, total: 4, rows: []}});
  assert.equal(new URL(e.requests.at(-1), 'http://test').searchParams.get('page'), '1');
  e.actionPending[2].next({data: {page: 1, pageSize: 5, total: 0, rows: []}});
  assert.equal(queue.data.total, 0); assert.equal(queue.error, ''); assert.equal(queue.loading, false);
});
