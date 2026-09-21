const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function setup(t) {
  const requests = [], timers = new Map(), intervals = new Map();
  let timerId = 0;
  const dependencies = {
    ApiService: {
      list(url) { const stream = new rx.Subject(); requests.push({ url, stream }); return stream; },
      get: () => rx.of({ data: { unreadCount: 2 } }),
    },
    OrganizationContextService: { getActiveOrganizationId: () => 'org-a', isSuperuser: () => false },
    AuthService: { token: () => '', currentUser: () => ({ organizationId: 'org-a', organizationName: 'Organization A' }), hasPermission: () => false },
    OrganizationMessagesService: { readChanges$: new rx.Subject() },
    SocketNotificationsService: { disconnect() {} },
  };
  const module = { exports: {} };
  const decorator = () => () => {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/layout/app-shell.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, {
    module, exports: module.exports, URLSearchParams, console,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    window: { addEventListener() {}, removeEventListener() {} },
    require(name) {
      if (name === 'rxjs') return rx;
      if (name === '@angular/core') return { Component: decorator, ViewChild: decorator, HostListener: decorator, inject: key => dependencies[key], computed: fn => fn };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const component = new module.exports.AppShellComponent();
  const viewport = { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 };
  component.notificationViewport = { nativeElement: viewport };
  t.after(() => component.ngOnDestroy());
  const respond = (index, ids, totalPages = 3) => {
    const request = requests[index];
    const page = Number(new URL(request.url, 'http://local').searchParams.get('page'));
    request.stream.next({ data: ids.map(id => ({ id, organizationId: 'org-a', title: id, message: 'Activity', isRead: false })), meta: { page, totalPages } });
    request.stream.complete();
  };
  const flush = () => { const pending = [...timers.entries()]; for (const [id, fn] of pending) { timers.delete(id); fn(); } };
  return { component, requests, viewport, respond, flush, intervals, dependencies };
}

test('scrolling near the bottom appends the next page once and deduplicates overlapping rows', t => {
  const s = setup(t); s.component.toggleNotifications(); s.respond(0, ['1', '2']);
  assert.match(s.requests[0].url, /organizationId=org-a/);
  s.component.onNotificationsScroll(); assert.equal(s.requests.length, 1);
  s.viewport.scrollTop = 650; s.component.onNotificationsScroll(); s.component.onNotificationsScroll();
  assert.equal(s.requests.length, 2); assert.match(s.requests[1].url, /page=2/);
  s.respond(1, ['2', '3'], 2);
  assert.equal(s.component.notifications.map(row => row.id).join(','), '1,2,3');
  s.component.onNotificationsScroll(); assert.equal(s.requests.length, 2);
});

test('short pages automatically fill the viewport and stop on an empty page', t => {
  const s = setup(t); s.viewport.scrollHeight = 100;
  s.component.toggleNotifications(); s.respond(0, ['1']); s.flush();
  assert.equal(s.requests.length, 2);
  s.respond(1, []); s.flush(); assert.equal(s.requests.length, 2);
});

test('loading failure preserves older rows, pauses automatic retries, and retries the failed page', t => {
  const s = setup(t); s.component.toggleNotifications(); s.respond(0, ['1']);
  s.viewport.scrollTop = 700; s.component.onNotificationsScroll();
  s.requests[1].stream.error({ error: { message: 'Offline' } });
  s.component.onNotificationsScroll(); assert.equal(s.requests.length, 2);
  assert.equal(s.component.notifications[0].id, '1');
  s.component.retryNotifications(); assert.match(s.requests[2].url, /page=2/);
  s.respond(2, ['2'], 2); assert.equal(s.component.notificationsLoadFailed, false);
});

test('closing cancels requests; reopening and refresh start at the first page without stale rows', t => {
  const s = setup(t); s.component.toggleNotifications(); const first = s.requests[0].stream;
  s.component.closeNotifications(); assert.equal(first.observers.length, 0);
  first.next({ data: [{ id: 'stale' }], meta: { totalPages: 4 } });
  assert.equal(s.component.notifications.length, 0);
  s.component.toggleNotifications(); s.respond(1, ['new']);
  s.viewport.scrollTop = 500; s.component.loadNotifications(1, false);
  assert.equal(s.component.notifications.length, 0); assert.equal(s.viewport.scrollTop, 0);
});

test('unread polling does not reset notification history or cancel scrolling requests', t => {
  const s = setup(t); s.component.toggleNotifications(); s.respond(0, ['1']);
  s.component.startUnreadCountPolling();
  for (const fn of s.intervals.values()) fn();
  assert.equal(s.requests.length, 1); assert.equal(s.component.notifications[0].id, '1');
});

test('live messages survive an in-flight first page and other organizations are ignored', t => {
  const s = setup(t); s.component.toggleNotifications();
  s.component.handleRealtimeMessage({ id: 'other', organizationId: 'org-b', title: 'Other', message: 'Other' });
  s.component.handleRealtimeMessage({ id: 'live', organizationId: 'org-a', title: 'Live', message: 'Live' });
  s.respond(0, ['live', 'older']);
  assert.equal(s.component.notifications.map(row => row.id).join(','), 'live,older');
  assert.equal(s.component.unreadMessageCount, 1);
});

test('mark-as-read updates remain read when an interrupted page is retried', t => {
  const s = setup(t); s.component.ngOnInit(); s.component.toggleNotifications(); s.respond(0, ['1']);
  s.viewport.scrollTop = 700; s.component.onNotificationsScroll();
  s.dependencies.OrganizationMessagesService.readChanges$.next({ messageId: '1', organizationId: 'org-a', readAt: '2026-09-21' });
  assert.equal(s.requests[1].stream.observers.length, 0);
  s.flush(); assert.match(s.requests[2].url, /page=2/); s.respond(2, ['1', '2'], 2);
  assert.equal(s.component.notifications[0].isRead, true);
});
