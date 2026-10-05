const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function environment() {
  const events = new rx.Subject(), timers = new Map(); let timerId = 0;
  const router = { url: '/dashboard', events };
  const signal = initial => {
    let value = initial; const read = () => value;
    read.set = next => { value = next; }; read.update = fn => { value = fn(value); }; return read;
  };
  const routing = { Router: 'router' };
  for (const name of ['NavigationStart', 'NavigationEnd', 'NavigationCancel', 'NavigationError', 'NavigationSkipped']) {
    routing[name] = class { constructor(id, url, urlAfterRedirects = url) { Object.assign(this, { id, url, urlAfterRedirects }); } };
  }
  const mocks = {
    '@angular/core': { Injectable: () => value => value, inject: key => key === 'router' ? router : navigation, signal, computed: fn => fn },
    '@angular/router': routing, '@angular/common/http': {}, rxjs: rx,
    './navigation-loading.service': { NavigationLoadingService: 'navigation' },
  };
  function load(filename) {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/core', filename + '.ts'), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: key => mocks[key],
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
    return module.exports;
  }
  const navigation = new (load('navigation-loading.service').NavigationLoadingService)();
  return { navigation, router, load, emit: (kind, id, url, destination) => events.next(new routing[kind](id, url, destination)),
    tick: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); } };
}

test('menu highlights immediately, and initial page reads keep content loading after route activation', () => {
  const e = environment(), n = e.navigation;
  assert.equal(n.loading(), false);
  e.emit('NavigationStart', 1, '/expenses?year=2026');
  assert.equal(n.loading(), true); assert.equal(n.isActive('/expenses'), true); assert.equal(n.isActive('/dashboard'), false);
  const finish = n.trackRead();
  e.emit('NavigationEnd', 1, '/expenses', '/expenses?year=2026');
  const finishRenderRead = n.trackRead(); e.tick();
  assert.equal(n.navigating(), false); assert.equal(n.loading(), true);
  finish(); assert.equal(n.loading(), true); finishRenderRead(); assert.equal(n.loading(), false);
  n.trackRead(); assert.equal(n.loading(), false); // Background polling never restarts the loader.
});

test('cancelled, failed and skipped navigation restore the current menu without a stuck loader', () => {
  for (const event of ['NavigationCancel', 'NavigationError', 'NavigationSkipped']) {
    const e = environment(), n = e.navigation;
    e.emit('NavigationStart', 1, '/expenses'); const finish = n.trackRead();
    e.emit(event, 1, '/expenses'); assert.equal(n.loading(), false); assert.equal(n.isActive('/dashboard'), true);
    finish(); assert.equal(n.loading(), false);
  }
});

test('old responses or cancellation cannot clear the new page loading state; duplicate completion is harmless', () => {
  const e = environment(), n = e.navigation;
  e.emit('NavigationStart', 1, '/expenses'); const oldFinish = n.trackRead();
  e.emit('NavigationStart', 2, '/vendors'); const finish = n.trackRead();
  e.emit('NavigationCancel', 1, '/expenses'); oldFinish();
  assert.equal(n.navigating(), true); assert.equal(n.isActive('/vendors'), true);
  e.emit('NavigationEnd', 2, '/vendors'); e.tick(); assert.equal(n.loading(), true);
  finish(); finish(); assert.equal(n.loading(), false);
});

test('redirect destinations and nested routes highlight the correct menu with path boundaries', () => {
  const e = environment(), n = e.navigation;
  e.emit('NavigationStart', 1, '/orders'); e.emit('NavigationEnd', 1, '/orders', '/reports/sales/123#preview');
  assert.equal(n.isActive('/reports'), true); assert.equal(n.isActive('/orders'), false); assert.equal(n.isActive('/report'), false);
});

test('the HTTP interceptor finishes tracked reads on success, failure and unsubscribe, excluding auth and writes', () => {
  const e = environment(), n = e.navigation, intercept = e.load('navigation-loading.interceptor').navigationLoadingInterceptor;
  e.emit('NavigationStart', 1, '/expenses');
  const stream = new rx.Subject(); const subscription = intercept({ method: 'GET', url: '/api/v1/expenses' }, () => stream).subscribe();
  e.emit('NavigationEnd', 1, '/expenses'); e.tick(); assert.equal(n.loading(), true);
  subscription.unsubscribe(); assert.equal(n.loading(), false);
  for (const request of [{ method: 'GET', url: '/api/v1/auth/session' },
                         { method: 'GET', url: '/api/v1/messages/unread-count?organizationId=example' },
                         { method: 'POST', url: '/api/v1/expenses' }]) {
    e.emit('NavigationStart', 2, '/vendors'); intercept(request, () => new rx.Subject()).subscribe();
    e.emit('NavigationEnd', 2, '/vendors'); e.tick(); assert.equal(n.loading(), false);
  }
  for (const fails of [false, true]) {
    e.emit('NavigationStart', 3, '/expenses'); const pending = new rx.Subject();
    intercept({ method: 'GET', url: '/api/v1/expenses' }, () => pending).subscribe({ error() {} });
    e.emit('NavigationEnd', 3, '/expenses'); e.tick(); assert.equal(n.loading(), true);
    if (fails) pending.error({ status: 500 }); else pending.complete(); assert.equal(n.loading(), false);
  }
});
