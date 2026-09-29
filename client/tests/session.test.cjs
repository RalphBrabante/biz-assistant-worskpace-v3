const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function setup() {
  let token = 'token-a', verified = false;
  const pending = [], redirects = [], timers = [], events = {};
  const auth = {
    token: () => token,
    sessionVerified: { set: value => { verified = value; } },
    clearSession() { token = ''; verified = false; },
    updateCurrentUser(user) { this.user = user; },
  };
  const deps = { auth, http: { get() { const stream = new rx.Subject(); pending.push(stream); return stream; } },
    router: { navigate: (...args) => redirects.push(args) }, organization: { clearSelectedOrganizationId() {} } };
  const mocks = {
    '@angular/core': { Injectable: () => value => value, inject: key => deps[key] },
    '@angular/common/http': { HttpClient: 'http' }, '@angular/router': { Router: 'router' },
    './auth.service': { AuthService: 'auth' }, './organization-context.service': { OrganizationContextService: 'organization' }, rxjs: rx,
  };
  const source = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/app/core/session.service.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: key => mocks[key], Date,
    setInterval: fn => { events.poll = fn; }, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    window: { addEventListener: (key, fn) => { events[key] = fn; } },
    document: { visibilityState: 'visible', addEventListener: (key, fn) => { events[key] = fn; } },
    localStorage: { getItem: () => token } });
  return { service: new module.exports.SessionService(), auth, pending, redirects, timers, events,
    verified: () => verified, setToken: value => { token = value; } };
}
const valid = () => ({ data: { user: { id: 'user-a' }, expiresAt: new Date(Date.now() + 60000).toISOString() } });

test('protected access waits for server validation and shares concurrent checks', () => {
  const e = setup(); const results = [];
  e.service.validate().subscribe(value => results.push(value));
  e.service.validate().subscribe(value => results.push(value));
  assert.equal(e.pending.length, 1); assert.equal(e.verified(), false); assert.equal(results.length, 0);
  e.pending[0].next(valid()); e.pending[0].complete();
  assert.deepEqual(results, [true, true]); assert.equal(e.verified(), true);
  e.timers.at(-1)(); assert.equal(e.auth.token(), ''); assert.equal(e.verified(), false);
  assert.equal(e.redirects[0][0][0], '/login');
});

test('rejected, expired and malformed sessions cannot reveal protected content', () => {
  for (const response of [null, { data: { user: { id: 'x' }, expiresAt: '2000-01-01' } }, { data: {} }]) {
    const e = setup(); let result;
    e.service.validate().subscribe(value => result = value);
    if (response) { e.pending[0].next(response); e.pending[0].complete(); }
    else e.pending[0].error({ status: 401 });
    assert.equal(result, false); assert.equal(e.verified(), false); assert.equal(e.auth.token(), '');
  }
});

test('a late validation response cannot restore a logged-out or replaced session', () => {
  const e = setup(); e.service.validate().subscribe(); e.setToken('new-token');
  e.pending[0].next(valid()); e.pending[0].complete();
  assert.equal(e.verified(), false); assert.equal(e.auth.token(), 'new-token');
});

test('tab focus hides content until revalidation completes and revocation clears session', () => {
  const e = setup(); e.service.validate().subscribe(); e.pending[0].next(valid()); e.pending[0].complete();
  e.events.focus(); assert.equal(e.verified(), false);
  e.pending[1].error({ status: 401 }); assert.equal(e.auth.token(), ''); assert.equal(e.redirects.length, 1);
});

function intercept({ status, url = '/api/v1/orders', currentToken = 'token-a', code } = {}) {
  let cleared = false, denied = false;
  const redirects = [];
  let reads = 0;
  const deps = {
    auth: { token: () => ++reads === 1 ? 'token-a' : currentToken, clearSession() { cleared = true; },
      clearUnauthorizedAccess() {}, showUnauthorizedAccess() { denied = true; } },
    router: { navigate: (...args) => redirects.push(args) },
    organization: { shouldApplySuperuserScope: () => false, clearSelectedOrganizationId() {} },
  };
  const mocks = {
    '@angular/core': { inject: key => deps[key] }, '@angular/common/http': {},
    '@angular/router': { Router: 'router' }, './auth.service': { AuthService: 'auth' },
    './organization-context.service': { OrganizationContextService: 'organization' },
    'rxjs/operators': rx, rxjs: rx,
  };
  const source = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/app/core/auth.interceptor.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: key => mocks[key], window: { location: { pathname: '/dashboard' } } });
  const request = { url, method: 'GET', clone() { return this; } };
  module.exports.authInterceptor(request, () => rx.throwError(() => ({ status, error: { code } }))).subscribe({ error() {} });
  return { cleared, denied, redirects };
}

test('all authenticated 401 responses and inactive licenses log out immediately', () => {
  for (const error of [{ status: 401 }, { status: 403, code: 'LICENSE_INACTIVE' }]) {
    const e = intercept(error); assert.equal(e.cleared, true); assert.equal(e.redirects[0][0][0], '/login');
  }
});
test('permission denials, failed login attempts, and old requests do not clear a valid session', () => {
  const permission = intercept({ status: 403 }); assert.equal(permission.cleared, false); assert.equal(permission.denied, true);
  assert.equal(intercept({ status: 401, url: '/api/v1/auth/login' }).cleared, false);
  assert.equal(intercept({ status: 401, currentToken: 'replacement-token' }).cleared, false);
});
