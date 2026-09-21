// Exercise inbox request/state behavior without a browser test runner.
// Angular templates are checked separately with ngc and the production build.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function setup() {
  const dependencies = {};
  const cache = new Map();
  const core = {
    Component: () => (value) => value, Injectable: () => (value) => value, ViewChild: () => () => {},
    inject: (key) => dependencies[key],
    signal: (value) => {
      const read = () => value;
      read.set = (next) => { value = next; };
      read.update = (fn) => { value = fn(value); };
      return read;
    },
  };
  function load(relative) {
    const filename = path.resolve(__dirname, '../src/app', relative);
    if (cache.has(filename)) return cache.get(filename);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
    }).outputText;
    const module = { exports: {} };
    const mocks = {
      '@angular/core': core, '@angular/common': {}, '@angular/forms': {}, '@angular/router': {},
      '../../shared/organization-required.component': {},
    };
    const requireMock = (name) => {
      if (name === 'rxjs') return rx;
      if (name in mocks) return mocks[name];
      if (name.endsWith('organization-message')) return load('core/organization-message.ts');
      if (name.endsWith('organization-messages.service')) return { OrganizationMessagesService: 'messages' };
      const tokens = {
        'api.service': 'ApiService', 'auth.service': 'AuthService',
        'organization-context.service': 'OrganizationContextService', 'confirm-dialog.service': 'ConfirmDialogService',
        'socket-notifications.service': 'SocketNotificationsService',
      };
      for (const [suffix, token] of Object.entries(tokens)) if (name.endsWith(suffix)) return { [token]: token };
      throw new Error(`Unexpected import: ${name}`);
    };
    vm.runInNewContext(source, { module, exports: module.exports, require: requireMock, URLSearchParams, Set, Date });
    cache.set(filename, module.exports);
    return module.exports;
  }
  const changes = new rx.Subject();
  const requests = [];
  const data = Array.from({ length: 11 }, (_, index) => ({ id: `m${index + 1}`, organizationId: 'org-a', title: `Message ${index + 1}`, message: 'Details', isRead: false }));
  const api = {
    list(url) {
      requests.push(url);
      const params = new URL(url, 'http://test').searchParams;
      const page = Number(params.get('page')); const limit = Number(params.get('limit'));
      const rows = data.filter((row) => !params.has('isRead') || row.isRead === (params.get('isRead') === 'true'));
      return rx.of({ data: rows.slice((page - 1) * limit, page * limit), meta: { total: rows.length, totalPages: Math.ceil(rows.length / limit), page } });
    },
    get() { return rx.of({ data: { unreadCount: data.filter((row) => !row.isRead).length } }); },
    put(url) {
      requests.push(url);
      if (url.includes('/read-all')) {
        const unread = data.filter((row) => !row.isRead);
        unread.forEach((row) => { row.isRead = true; });
        return rx.of({ data: { updatedCount: unread.length } });
      }
      const row = data.find((item) => url.includes(`/${item.id}/`));
      row.isRead = true;
      return rx.of({ data: { ...row, readAt: '2026-09-21T00:00:00Z' } });
    },
  };
  dependencies.ApiService = api;
  dependencies.AuthService = { hasPermission: () => true };
  dependencies.OrganizationContextService = { getActiveOrganizationId: () => 'org-a' };
  dependencies.ConfirmDialogService = { confirm: async () => true };
  dependencies.SocketNotificationsService = { messageCreated$: changes };
  dependencies.messages = new (load('core/organization-messages.service.ts').OrganizationMessagesService)();
  const page = new (load('pages/messages-page/messages-page.component.ts').MessagesPageComponent)();
  return { page, api, requests, data, changes, dependencies, load };
}

test('filters always include the selected organization and encode search text', () => {
  const { page, requests } = setup();
  page.query = 'Invoice & order'; page.entityTypeFilter = 'sales_invoice'; page.isReadFilter = 'unread';
  page.applyFilters();
  const params = new URL(requests[0], 'http://test').searchParams;
  assert.equal(params.get('organizationId'), 'org-a');
  assert.equal(params.get('q'), 'Invoice & order');
  assert.equal(params.get('isRead'), 'false');
  assert.equal(params.get('entityType'), 'sales_invoice');
});

test('a stale list response cannot replace the latest search results', () => {
  const { page, api } = setup(); const first = new rx.Subject(); const second = new rx.Subject();
  let calls = 0; api.list = () => ++calls === 1 ? first : second;
  page.load(); page.query = 'new'; page.applyFilters();
  second.next({ data: [{ id: 'new' }], meta: { total: 1 } });
  first.next({ data: [{ id: 'old' }], meta: { total: 1 } });
  assert.equal(page.rows()[0].id, 'new'); page.ngOnDestroy();
});

test('marking the last unread row on page two returns to page one and updates the count', () => {
  const { page, data, requests } = setup();
  page.pageSize = 10; page.isReadFilter = 'unread'; page.ngOnInit(); page.goToPage(2);
  page.markAsRead(data[10]);
  assert.equal(page.page, 1); assert.equal(page.total, 10); assert.equal(page.rows().length, 10);
  assert.equal(page.unreadCount(), 10); assert.equal(page.pendingReadIds().size, 0);
  assert.ok(requests.some((url) => url.includes('/m11/read'))); page.ngOnDestroy();
});

test('failed read keeps a message unread and allows a retry', () => {
  const { page, api, data } = setup(); page.ngOnInit();
  api.put = () => rx.throwError(() => ({ error: { message: 'Try again' } }));
  page.markAsRead(data[0]);
  assert.equal(data[0].isRead, false); assert.equal(page.pendingReadIds().size, 0); assert.equal(page.error(), 'Try again');
  page.ngOnDestroy();
});

test('bulk read cancellation sends nothing; confirmed action scopes all messages to the organization', async () => {
  const { page, requests, dependencies, data } = setup(); page.ngOnInit();
  dependencies.ConfirmDialogService.confirm = async () => false;
  await page.markAllAsRead(); assert.ok(!requests.some((url) => url.includes('/read-all')));
  dependencies.ConfirmDialogService.confirm = async () => true;
  page.query = 'filtered'; await page.markAllAsRead();
  assert.ok(requests.includes('/api/v1/messages/read-all?organizationId=org-a'));
  assert.ok(data.every((row) => row.isRead)); assert.equal(page.unreadCount(), 0); page.ngOnDestroy();
});

test('live messages respect scope, deduplicate, and stop updating after destruction', () => {
  const { page, changes } = setup(); page.ngOnInit();
  changes.next({ id: 'outside', organizationId: 'org-b' }); assert.equal(page.newMessageCount(), 0);
  changes.next({ id: 'new', organizationId: 'org-a' }); changes.next({ id: 'new', organizationId: 'org-a' });
  assert.equal(page.newMessageCount(), 1); page.ngOnDestroy();
  changes.next({ id: 'later', organizationId: 'org-a' }); assert.equal(page.newMessageCount(), 1);
});

test('related links use known routes, encoded IDs and invoice fallback permissions', () => {
  const { load } = setup(); const { messageTarget } = load('core/organization-message.ts');
  assert.equal(messageTarget({ entityType: 'order', entityId: 'a/b' }).path, '/orders/a%2Fb');
  const fallback = messageTarget({ entityType: 'sales_invoice', metadata: { orderId: 'order-1' } });
  assert.equal(fallback.path, '/orders/order-1'); assert.equal(fallback.permission, 'orders.read');
  assert.equal(messageTarget({ entityType: 'item', entityId: 'item-1' }).path, '/items');
  assert.equal(messageTarget({ entityType: 'unknown', metadata: { url: 'https://example.com' } }), null);
});


test('pressing Enter does not repeat the pending debounced search', async () => {
  const { page, requests } = setup(); page.ngOnInit();
  page.query = 'new search'; page.onSearchChange(); page.applyFilters();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(requests.filter((url) => url.includes('q=new+search')).length, 1);
  page.ngOnDestroy();
});
