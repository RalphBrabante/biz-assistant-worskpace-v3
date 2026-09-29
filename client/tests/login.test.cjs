const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject } = require('rxjs');

function setup() {
  const requests = [], sessions = [];
  let resolve, reject;
  const navigation = new Promise((yes, no) => { resolve = yes; reject = no; });
  const router = { url: '/', navigate: () => navigation };
  const deps = { http: { post(url, payload) { const stream = new Subject(); requests.push({ url, payload, stream }); return stream; } },
    auth: { setSession: (...args) => sessions.push(args) }, router, theme: {} };
  const mocks = {
    '@angular/core': { Component: () => value => value, inject: key => deps[key] },
    '@angular/common': {}, '@angular/forms': {}, '@angular/common/http': { HttpClient: 'http' },
    '@angular/router': { Router: 'router' }, '../../core/auth.service': { AuthService: 'auth' },
    '../../core/theme.service': { ThemeService: 'theme' }, '../../shared/modal.directive': {},
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/pages/login-page/login-page.component.ts'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: key => mocks[key] });
  const page = new module.exports.LoginPageComponent();
  page.email = 'synthetic@example.test'; page.password = 'synthetic-only';
  return { page, requests, sessions, router, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('valid submission locks synchronously and ignores repeated form/keyboard and organization submissions', () => {
  const { page, requests } = setup();
  page.submit(); assert.equal(page.loading, true);
  page.selectedOrganizationId = 'keep';
  page.submit(); page.submitWithSelectedOrganization();
  assert.equal(requests.length, 1); assert.equal(page.selectedOrganizationId, 'keep');
});
test('invalid or empty form never starts login', () => {
  const { page, requests } = setup();
  page.submit(false); page.password = ''; page.submit();
  assert.equal(requests.length, 0); assert.equal(page.loading, false);
});
test('slow HTTP and navigation retain pending even after HTTP completes', async () => {
  const e = setup(); e.page.submit(); await flush(); assert.equal(e.page.loading, true);
  e.requests[0].stream.next({ data: { accessToken: 'synthetic-token' } }); e.requests[0].stream.complete();
  await flush(); e.page.submit(); assert.equal(e.page.loading, true); assert.equal(e.requests.length, 1);
  assert.equal(e.sessions.length, 1); e.resolve(true); await flush(); assert.equal(e.page.loading, true);
});
test('HTTP errors and malformed responses unlock with clear feedback and permit retry', () => {
  for (const failure of ['credentials', 'network', 'missing-token']) {
    const e = setup(); e.page.submit();
    if (failure === 'missing-token') e.requests[0].stream.next({ data: {} });
    else e.requests[0].stream.error(failure === 'credentials' ? { error: { message: 'Invalid credentials.' } } : { status: 0 });
    assert.equal(e.page.loading, false); assert.ok(e.page.error);
    e.page.submit(); assert.equal(e.requests.length, 2); assert.equal(e.page.error, '');
  }
});
test('cancelled, rejected, or login-redirected navigation shows retryable feedback', async () => {
  for (const outcome of ['cancel', 'reject', 'redirect']) {
    const e = setup(); e.page.submit(); e.requests[0].stream.next({ data: { accessToken: 'synthetic-token' } });
    if (outcome === 'reject') e.reject(new Error('route failed'));
    else { if (outcome === 'redirect') e.router.url = '/login'; e.resolve(outcome !== 'cancel'); }
    await flush(); assert.equal(e.page.loading, false); assert.match(e.page.error, /try again/);
    e.page.submit(); assert.equal(e.requests.length, 2);
  }
});
test('organization selection stays interactive between requests and locked during continuation', () => {
  const e = setup(); e.page.submit();
  e.requests[0].stream.error({ error: { code: 'ORGANIZATION_SELECTION_REQUIRED', data: {
    organizations: [{ id: 'disabled', hasActiveLicense: false }, { id: 'eligible' }], suggestedOrganizationId: 'disabled' } } });
  assert.equal(e.page.loading, false); assert.equal(e.page.organizationSelectionVisible, true);
  assert.equal(e.page.selectedOrganizationId, 'eligible');
  e.page.submitWithSelectedOrganization(); e.page.closeOrganizationSelectionModal(); e.page.submitWithSelectedOrganization();
  assert.equal(e.page.organizationSelectionVisible, true); assert.equal(e.requests.length, 2);
  assert.equal(e.requests[1].payload.organizationId, 'eligible');
  e.requests[1].stream.error({ error: { message: 'Organization unavailable.' } });
  assert.equal(e.page.loading, false); assert.equal(e.page.organizationSelectionError, 'Organization unavailable.');
  e.page.submitWithSelectedOrganization(); assert.equal(e.requests.length, 3);
});
