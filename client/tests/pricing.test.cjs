const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { Subject } = require('rxjs');
const domainPath = path.join(__dirname, '../../api/src/modules/pricing/pricing-domain.ts');
function transpile(file, dependencies) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: key => dependencies[key], Intl, URL, crypto: require('node:crypto').webcrypto }); return module.exports;
}
const domain = transpile(domainPath, {});
async function setup() {
  await import('@angular/compiler');
  const forms = await import('@angular/forms');
  const directory = path.join(__dirname, '../src/app/pages/pricing-page');
  const mocks = { '@angular/core': { Component: () => value => value, Inject: () => () => {}, ViewChild: () => () => {} }, '@angular/common': {}, '@angular/forms': forms,
    '@angular/common/http': { HttpHeaders: class {} }, '@angular/router': {}, '@angular/platform-browser': {}, 'rxjs': require('rxjs'),
    '../../core/theme.service': {}, '../../shared/tooltip.directive': {}, './pricing-capacity-fields.component': {},
    '../../../../../api/src/modules/pricing/pricing-domain': domain };
  mocks['./pricing-capacity'] = transpile(path.join(directory, 'pricing-capacity.ts'), mocks);
  const { PricingPageComponent } = transpile(path.join(directory, 'pricing-page.component.ts'), mocks);
  const requests = [], links = []; let titleValue = 'Original'; const descriptions = new Map();
  const title = { getTitle: () => titleValue, setTitle: value => { titleValue = value; } };
  const meta = { getTag: () => undefined, updateTag: value => descriptions.set(value.name, value.content), removeTag: () => descriptions.delete('description') };
  const document = { activeElement: { focus() {} }, querySelector: () => null, head: { appendChild: node => links.push(node) }, createElement: () => ({ setAttribute() {} }) };
  const http = Object.fromEntries(['get', 'post'].map(method => [method, (url, payload) => { const stream = new Subject(); requests.push({ method, url, payload, stream }); return stream; }]));
  const page = new PricingPageComponent(http, {}, title, meta, document);
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } }; page.requestDialog = { nativeElement: dialog };
  page.ngOnInit(); requests[0].stream.next({ data: { catalogue: domain.PRICING_CATALOGUE, requestChallenge: 'signed-challenge', canonicalUrl: null } });
  return { page, requests, dialog, title, descriptions, links };
}
function validRequest(e) {
  e.page.openRequest('silver', { organizations: 7, users: 8, storageGB: 25, mailboxes: 3 });
  e.requests.at(-1).stream.next({ data: { requestChallenge: 'refreshed-challenge' } });
  e.page.contactForm.setValue({ name: 'Synthetic Buyer', email: 'buyer@example.test', firmName: '', marketingConsent: false });
}
test('real Angular quantity controls reject empty/fractional counts and accept finite fractional GB', async () => {
  const e = await setup(); assert.equal(e.page.estimate.planId, 'bronze');
  e.page.capacityForm.controls.users.setValue(1.5); assert.equal(e.page.estimate, null);
  e.page.capacityForm.controls.users.setValue(null); assert.equal(e.page.estimate, null);
  e.page.capacityForm.controls.users.setValue(8); e.page.capacityForm.patchValue({ organizations: 7, storageGB: 25, mailboxes: 3 });
  assert.equal(e.page.estimate.planId, 'silver'); assert.equal(e.page.estimate.subtotalMinor, 559400);
  e.page.setCycle('annual'); assert.equal(e.page.estimate.subtotalMinor, 5594000);
  e.page.capacityForm.controls.storageGB.setValue(25.01); assert.equal(e.page.estimate.lines.find(l => l.id === 'storage_10gb').quantity, 1);
  e.page.selectedPlanId = 'gold'; assert.equal(e.page.estimate.planId, 'gold'); assert.equal(e.page.recommended.planId, 'silver');
});
test('plan-card checkmarks exclude planned, unverified and unincluded features', async () => {
  const e = await setup(); e.page.catalogue = structuredClone(domain.PRICING_CATALOGUE);
  const plan = e.page.catalogue.plans[0];
  e.page.catalogue.features.find(f => f.id === 'sales').availability = 'planned';
  e.page.catalogue.features.find(f => f.id === 'expenses').availability = 'unverified';
  plan.includedFeatureIds = plan.includedFeatureIds.filter(id => id !== 'quarterly');
  assert.equal(e.page.cardFeatures(plan).map(f => f.id).join(','), 'worksheets');
});
test('requests prefill selected plan/cadence/capacity, lock during persistence, and show exact success only for saved receipt', async () => {
  const e = await setup(); e.page.setCycle('annual'); validRequest(e); assert.equal(e.dialog.open, true); assert.equal(e.page.requestCycle, 'annual');
  assert.equal(e.page.requestEstimate.subtotalMinor, 5594000); e.page.submitRequest();
  assert.equal(e.page.submitting, true); assert.equal(e.page.requestSuccess, ''); assert.equal(e.page.contactForm.disabled, true);
  const request = e.requests.at(-1); assert.equal(request.method, 'post'); assert.equal(request.payload.planId, 'silver'); assert.equal(request.payload.capacity.users, 8); assert.equal(request.payload.marketingConsent, false);
  assert.equal(request.payload.subtotalMinor, undefined); const count = e.requests.length;
  e.page.submitRequest(); e.page.closeRequest(); assert.equal(e.requests.length, count); assert.equal(e.dialog.open, true);
  let prevented = false; e.page.cancelRequest({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  request.stream.next({ data: { id: 'saved' }, message: 'Your plan request has been received. No payment has been taken.' });
  assert.equal(e.page.submitting, false); assert.equal(e.page.requestSuccess, 'Your plan request has been received. No payment has been taken.'); e.page.closeRequest(); assert.equal(e.dialog.open, false);
});
test('errors and malformed successes preserve entered values and retries reuse idempotency key until selection changes', async () => {
  for (const outcome of ['network', 'empty', 'unconfirmed']) {
    const e = await setup(); validRequest(e); e.page.submitRequest(); const request = e.requests.at(-1), key = request.payload.requestKey;
    if (outcome === 'network') request.stream.error({ status: 503, error: { message: 'Please try again.' } });
    else request.stream.next(outcome === 'empty' ? null : { data: {}, message: 'Success' });
    assert.equal(e.page.submitting, false); assert.equal(e.page.requestSuccess, ''); assert.ok(e.page.requestError); assert.equal(e.page.contactForm.controls.name.value, 'Synthetic Buyer'); assert.equal(e.page.requestCapacityForm.controls.users.value, 8);
    e.page.submitRequest(); assert.equal(e.requests.at(-1).payload.requestKey, key); e.requests.at(-1).stream.error({ status: 0 });
    e.page.requestCapacityForm.controls.users.setValue(9); e.page.submitRequest(); assert.notEqual(e.requests.at(-1).payload.requestKey, key);
  }
});
test('invalid contact/capacity, missing challenge and unverified live catalogue cannot submit or display purchasing', async () => {
  const e = await setup(); e.page.openRequest('bronze'); e.requests.at(-1).stream.next({ data: { requestChallenge: null } }); const count = e.requests.length;
  e.page.submitRequest(); assert.equal(e.requests.length, count); assert.ok(e.page.requestError);
  e.page.loadCatalogue(); e.requests.at(-1).stream.next({ data: { catalogue: { ...domain.PRICING_CATALOGUE, launchMode: 'live', ctaMode: 'checkout' } } });
  assert.equal(e.page.catalogue, null); assert.ok(e.page.loadError);
});
test('metadata is useful, canonical has no unconfigured fallback and errors can retry catalogue', async () => {
  const e = await setup(); assert.equal(e.title.getTitle(), 'Pricing | GIMO Biz Assistant'); assert.match(e.descriptions.get('description'), /workspace plans/); assert.equal(e.links.length, 0);
  e.page.loadCatalogue(); e.requests.at(-1).stream.error({ status: 503 }); assert.ok(e.page.loadError); assert.equal(e.page.loading, false);
  e.page.loadCatalogue(); e.requests.at(-1).stream.next({ data: { catalogue: domain.PRICING_CATALOGUE, canonicalUrl: 'https://app.example.test/pricing', requestChallenge: 'signed' } }); assert.equal(e.links[0].href, 'https://app.example.test/pricing');
});
test('pricing is lazy and outside protected shell; public API calls bypass login/org interception only for exact public methods', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/app/app.routes.ts'), 'utf8');
  assert.ok(routes.indexOf("path: 'pricing'") < routes.indexOf('component: AppShellComponent'));
  assert.match(routes, /path: 'pricing', loadComponent:/); assert.match(routes, /canActivate: \[authGuard\]/); assert.match(routes, /canActivateChild: \[authGuard\]/); assert.match(routes, /path: 'orders'.*canActivate: \[permissionGuard\]/);
  const file = path.join(__dirname, '../src/app/core/auth.interceptor.ts');
  const mock = { '@angular/core': { inject() { throw new Error('protected interceptor reached'); } }, '@angular/common/http': {}, '@angular/router': {}, 'rxjs/operators': {}, 'rxjs': {}, './auth.service': {}, './organization-context.service': {} };
  const { authInterceptor } = transpile(file, mock);
  for (const [method, url] of [['GET', '/api/v1/pricing/catalogue'], ['POST', '/api/v1/pricing/requests']]) { const req = { method, url }; assert.equal(authInterceptor(req, value => value), req); }
  for (const [method, url] of [['GET', '/api/v1/pricing/requests'], ['POST', '/api/v1/pricing/catalogue'], ['POST', '/api/v1/orders']]) assert.throws(() => authInterceptor({ method, url }, value => value), /protected interceptor/);
  const html = fs.readFileSync(path.join(__dirname, '../src/app/pages/pricing-page/pricing-page.component.html'), 'utf8');
  assert.doesNotMatch(html, /\/signup|Start a 14-day trial|No card required|Most popular|checkout|unlimited/i); assert.match(html, /href="\/pricing#compare"/); assert.match(html, /<dialog/); assert.match(html, /<details/); assert.match(html, /Tax treatment will be confirmed before purchase/);
});
