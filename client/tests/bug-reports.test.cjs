const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function load(relativePath, dependencies) {
  const module = {exports: {}};
  const source = ts.transpileModule(fs.readFileSync(require.resolve(relativePath), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true}}).outputText;
  vm.runInNewContext(source, {module, exports: module.exports, URLSearchParams, console, require(name) {
    if (name === 'rxjs') return rx;
    if (name === '@angular/core') return {Component: () => value => value, inject: key => dependencies[key]};
    return new Proxy({}, {get: (_target, key) => key});
  }});
  return module.exports;
}

function setup() {
  const requests = [];
  const dependencies = {
    ApiService: {
      create(url, payload) {const stream = new rx.Subject(); requests.push({url, payload, stream}); return stream;},
      getFresh(url) {const stream = new rx.Subject(); requests.push({url, stream, fresh: true}); return stream;},
      put(url, payload) {const stream = new rx.Subject(); requests.push({url, payload, stream}); return stream;},
    },
    Router: {url: '/expenses/123?token=secret#private'},
    OrganizationContextService: {getActiveOrganizationId: () => 'org-a'},
  };
  const {BugReportComponent} = load('../src/app/shared/bug-report.component.ts', dependencies);
  const {BugReportsPageComponent} = load('../src/app/pages/bug-reports-page/bug-reports-page.component.ts', dependencies);
  return {modal: new BugReportComponent(), page: new BugReportsPageComponent(), dependencies, requests};
}

test('modal captures a safe page path, validates text and blocks duplicate submissions', () => {
  const e = setup(); e.modal.open(); assert.equal(e.modal.pagePath, '/expenses/123');
  e.modal.submit(); assert.equal(e.requests.length, 0); assert.match(e.modal.error, /title/);
  e.modal.title = 'Problem'; e.modal.description = 'Cannot save'; e.modal.submit(); e.modal.submit();
  assert.equal(e.requests.length, 1); assert.equal(e.requests[0].payload.organizationId, 'org-a');
  assert.equal(e.requests[0].payload.pagePath, '/expenses/123');
  e.modal.close(); assert.equal(e.modal.visible, true);
  e.requests[0].stream.next({data: {id: 'report-1'}}); e.modal.submit(); assert.equal(e.requests.length, 1);
  assert.equal(e.modal.submitted, true); e.modal.close(); assert.equal(e.modal.visible, false);
  e.modal.open(); assert.equal(e.modal.title, ''); assert.equal(e.modal.description, ''); assert.equal(e.modal.submitted, false);
});

test('failed submissions preserve the draft and can be retried; closing does not clear a draft', () => {
  const e = setup(); e.modal.open(); e.modal.title = 'Problem'; e.modal.description = 'Details'; e.modal.submit();
  e.requests[0].stream.error({error: {message: 'Temporarily unavailable'}});
  assert.equal(e.modal.title, 'Problem'); assert.equal(e.modal.submitting, false); assert.match(e.modal.error, /unavailable/);
  e.modal.close(); e.modal.open(); assert.equal(e.modal.description, 'Details');
  e.modal.submit(); assert.equal(e.requests.length, 2);
  e.modal.ngOnDestroy(); assert.equal(e.requests[1].stream.observers.length, 0);
});

function boardFixture() {
  const report = {id: 'report-1', title: 'Cannot save', description: 'An error occurred', organizationId: 'org-a', status: 'open'};
  const columns = [
    {id: 'open', name: 'Open', isSystem: true, total: 1, rows: [report]},
    {id: 'in_progress', name: 'In progress', isSystem: true, total: 0, rows: []},
    {id: 'custom-a', name: 'Needs testing', organizationId: 'org-a', isSystem: false, total: 0, rows: []},
    {id: 'custom-b', name: 'Other team', organizationId: 'org-b', isSystem: false, total: 0, rows: []},
  ];
  return {data: {columns, total: 1, canCreateColumn: true}};
}
function loaded() {
  const e = setup(); e.page.load(); e.requests[0].stream.next(boardFixture()); return e;
}

test('board requests are fresh, scoped and searchable; stale requests are cancelled', () => {
  const e = setup(); e.page.load(); e.page.search = 'save'; e.page.applySearch();
  assert.equal(e.requests[0].fresh, true); assert.equal(e.requests[0].stream.observers.length, 0);
  const params = new URL(e.requests[1].url, 'http://test').searchParams;
  assert.equal(params.get('organizationId'), 'org-a'); assert.equal(params.get('q'), 'save');
  e.requests[1].stream.error({}); assert.match(e.page.error, /Unable/); assert.equal(e.page.loading, false);
  e.page.load(); e.requests[2].stream.next({data: {columns: [], total: 0, canCreateColumn: true}});
  assert.equal(e.page.error, ''); assert.equal(e.page.columns.length, 0);
});

test('dragging a report updates the destination optimistically and restores it on a failed save', () => {
  const e = loaded(), report = e.page.columns[0].rows[0], target = e.page.columns[2];
  const event = {preventDefault() {}, dataTransfer: {setData() {}}};
  e.page.startDrag(event, report); e.page.dragOver(event, target); assert.equal(e.page.dropTargetId, 'custom-a');
  e.page.drop(event, target); e.page.moveReport(report, target);
  assert.equal(e.requests.length, 2); assert.equal(e.requests[1].payload.status, 'custom-a');
  assert.equal(e.requests[1].payload.expectedStatus, 'open'); assert.equal(e.page.columns[0].total, 0);
  assert.equal(target.rows[0].status, 'custom-a'); assert.equal(target.total, 1);
  e.requests[1].stream.error({}); assert.equal(e.page.columns[0].rows[0].id, report.id);
  assert.equal(e.page.columns[0].total, 1); assert.equal(target.total, 0); assert.match(e.page.error, /restored/);
});

test('keyboard status changes save once and refresh; errors keep the details available', () => {
  const e = loaded(); e.page.open(e.page.columns[0].rows[0]); e.page.selectedStatus = 'in_progress'; e.page.save(); e.page.save();
  assert.equal(e.requests.length, 2); e.page.close(); assert.notEqual(e.page.selected, null);
  e.requests[1].stream.error({}); assert.match(e.page.saveError, /restored/); assert.notEqual(e.page.selected, null);
  e.page.save(); e.requests[2].stream.next({ok: true}); assert.equal(e.page.selected, null); assert.equal(e.requests.length, 4);
  e.page.ngOnDestroy(); assert.equal(e.requests[3].stream.observers.length, 0);
});

test('stale moves refresh authoritative data and cross-organization columns cannot be used', () => {
  const e = loaded(), report = e.page.columns[0].rows[0];
  e.page.moveReport(report, e.page.columns[3]); assert.equal(e.requests.length, 1);
  e.page.moveReport(report, e.page.columns[0]); assert.equal(e.requests.length, 1);
  e.page.moveReport(report, e.page.columns[2]); e.requests[1].stream.error({status: 409, error: {message: 'Moved by another reviewer'}});
  assert.equal(e.requests.length, 3); assert.match(e.page.notice, /another reviewer/); assert.equal(e.page.loading, true);
});

test('custom column creation validates, handles duplicates, and refreshes after saving', () => {
  const e = loaded(); e.page.openColumnModal(); e.page.createColumn(); assert.equal(e.requests.length, 1);
  e.page.columnName = 'Needs testing'; e.page.createColumn(); e.page.createColumn();
  assert.equal(e.requests.length, 2); assert.equal(e.requests[1].payload.name, 'Needs testing');
  assert.match(e.requests[1].url, /organizationId=org-a/);
  e.requests[1].stream.error({error: {message: 'Already exists'}}); assert.match(e.page.columnError, /Already/); assert.equal(e.page.columnModalOpen, true);
  e.page.columnName = 'Ready to release'; e.page.createColumn(); e.requests[2].stream.next({data: {id: 'new'}});
  assert.equal(e.page.columnModalOpen, false); assert.equal(e.requests.length, 4);
});

test('each column paginates independently, without duplicate cards or simultaneous loads', () => {
  const e = loaded(), column = e.page.columns[0]; column.total = 21;
  e.page.loadMore(column); e.page.loadMore(column); assert.equal(e.requests.length, 2);
  const params = new URL(e.requests[1].url, 'http://test').searchParams;
  assert.equal(params.get('status'), 'open'); assert.equal(params.get('page'), '2');
  e.requests[1].stream.next({data: [{id: 'report-1'}, {id: 'report-2'}], meta: {total: 21}});
  assert.equal(column.rows.length, 2); assert.equal(column.page, 2);
  assert.equal(e.page.columns[2].page, 1);
});

test('review route denies non-admin users independently of permission grants', () => {
  for (const privileged of [true, false]) {
    const {administratorGuard} = load('../src/app/core/administrator.guard.ts', {AuthService: {isPrivileged: () => privileged}, Router: {parseUrl: path => path}});
    assert.equal(administratorGuard(), privileged ? true : '/profile');
  }
});
