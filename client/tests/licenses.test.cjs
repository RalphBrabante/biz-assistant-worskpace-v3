const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

const app = path.join(__dirname, '../src/app');
const formsStub = { Validators: { required: () => null, maxLength: () => () => null } };

// Transpiles a TypeScript source and the license helpers it imports. Other imports come from `stubs`,
// or become proxies whose members are their own names (so inject('ApiService') finds the fake).
function load(file, stubs = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, Date, URLSearchParams, setTimeout, crypto: globalThis.crypto, navigator: {},
    require(name) {
      if (name in stubs) return stubs[name];
      if (/license-utils|pricing-domain/.test(name)) return load(path.resolve(path.dirname(file), `${name}.ts`), stubs);
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return module.exports;
}

const utils = load(path.join(app, 'shared/license-utils.ts'), { '@angular/forms': formsStub });
const NOW = new Date('2026-11-01T00:00:00Z');
const inDays = (days) => new Date(NOW.getTime() + days * 86400000).toISOString();

test('license state follows the same access rule as the API', () => {
  const base = { id: 'l', key: 'k', status: 'active', isActive: true, revokedAt: null };
  assert.equal(utils.licenseState({ ...base, expiresAt: inDays(90) }, NOW).label, 'Active');
  const soon = utils.licenseState({ ...base, expiresAt: inDays(12) }, NOW);
  assert.equal(soon.label, 'Expiring Soon');
  assert.equal(soon.tone, 'warning');
  assert.equal(soon.detail, 'Expires in 12 days');
  // Revoked and suspended licenses are never green, whatever their date.
  assert.equal(utils.licenseState({ ...base, status: 'revoked', expiresAt: inDays(90) }, NOW).tone, 'danger');
  assert.equal(utils.licenseState({ ...base, status: 'suspended', expiresAt: inDays(90) }, NOW).grantsAccess, false);
  // An "active" row whose date has passed is shown as expired before the hourly job catches up.
  assert.equal(utils.licenseState({ ...base, expiresAt: inDays(-3) }, NOW).label, 'Expired');
  assert.equal(utils.licenseState({ ...base, isActive: false, expiresAt: inDays(90) }, NOW).label, 'Disabled');
});

test('seat summaries treat 0 and blank as unlimited and flag full or over-limit licenses', () => {
  assert.deepEqual({ ...utils.seatSummary({ maxUsers: 0, seatsUsed: 7 }) }, { label: '7 / Unlimited', full: false, over: false });
  assert.deepEqual({ ...utils.seatSummary({ maxUsers: 5, seatsUsed: 5 }) }, { label: '5 / 5', full: true, over: false });
  assert.deepEqual({ ...utils.seatSummary({ maxUsers: 5, seatsUsed: 6 }) }, { label: '6 / 5', full: true, over: true });
});

test('extension preview matches the API: from the current expiry, or from now once lapsed', () => {
  assert.equal(utils.previewExtension('2026-12-15T00:00:00Z', 12, NOW).toISOString(), '2027-12-15T00:00:00.000Z');
  assert.equal(utils.previewExtension('2026-09-01T00:00:00Z', 1, NOW).toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(utils.previewExtension('2027-01-31T00:00:00Z', 1, NOW).toISOString(), '2027-02-28T00:00:00.000Z');
});

test('plans come from the pricing catalogue and legacy plan names stay selectable', () => {
  const names = [...utils.planOptions().map((plan) => plan.name)];
  assert.deepEqual(names, ['Bronze', 'Silver', 'Gold']);
  const legacy = utils.planOptions('Enterprise 2025');
  assert.equal(legacy.at(-1).name, 'Enterprise 2025');
  assert.equal(legacy.at(-1).includedUsers, null);
  assert.equal(utils.planOptions('Silver').length, 3);
});

test('payloads send blank seats as unlimited, ISO dates, and the key only on create', () => {
  const payload = utils.licensePayload({ organizationId: '', planName: ' Gold ', status: 'active', startsAt: '2026-11-01T08:00', expiresAt: '2027-11-01T08:00', maxUsers: '', isActive: true, notes: '', key: 'abc' }, false);
  assert.equal(payload.organizationId, null);
  assert.equal(payload.planName, 'Gold');
  assert.equal(payload.maxUsers, null);
  assert.match(payload.startsAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal('key' in payload, false);
  assert.equal(utils.licensePayload({ maxUsers: '15', key: 'abc' }, true).key, 'abc');
  assert.equal(utils.licensePayload({ maxUsers: '15' }, true).maxUsers, 15);
});

function page({ superuser = true } = {}) {
  const requests = [];
  const api = new Proxy({}, { get: (_, method) => (url, body) => { const stream = new rx.Subject(); requests.push({ method, url, body, stream }); return stream; } });
  const deps = {
    ApiService: api,
    ConfirmDialogService: { confirm: async () => true },
    OrganizationContextService: { isSuperuser: () => superuser },
    FormBuilder: { group: (controls) => ({ controls, get: () => ({ value: '' }), patchValue() {}, getRawValue: () => ({}) }) },
  };
  const stubs = {
    rxjs: rx,
    '@angular/core': { Component: () => (value) => value, inject: (key) => deps[key], signal: (initial) => { let value = initial; const read = () => value; read.set = (next) => { value = next; }; return read; } },
    '@angular/forms': { ...formsStub, FormBuilder: 'FormBuilder' },
    '../../core/table-preferences': { loadTablePreferences: () => ({}), saveTablePreferences() {}, toPositiveInt: (_, fallback) => fallback, toTableViewMode: (_, fallback) => fallback },
  };
  const { LicensesPageComponent } = load(path.join(app, 'pages/licenses-page/licenses-page.component.ts'), stubs);
  const component = new LicensesPageComponent();
  return { component, requests };
}

test('filters go to the server and reset to page one; the overview tiles toggle the status filter', () => {
  const { component, requests } = page();
  component.page = 3;
  component.onStatusFilterChange('expiring');
  assert.match(requests.at(-1).url, /status=expiring/);
  assert.match(requests.at(-1).url, /page=1/);
  component.onPlanFilterChange('Silver');
  component.onFilterChange('acme');
  assert.match(requests.at(-1).url, /planName=Silver/);
  assert.match(requests.at(-1).url, /q=acme/);
  assert.equal(component.activeFilterCount, 3);
  component.toggleStatusFilter('expiring');
  assert.equal(component.statusFilter, '');
  component.clearFilters();
  assert.equal(component.hasActiveFilters, false);
  assert.doesNotMatch(requests.at(-1).url, /status=|planName=|q=/);
});

test('organization administrators get a read-only page and cannot open the create form', () => {
  const { component, requests } = page({ superuser: false });
  component.ngOnInit();
  assert.equal(component.canManage, false);
  // Only the license list loads; the organization picker is platform-only.
  assert.deepEqual(requests.map((request) => request.url.split('?')[0]), ['/api/v1/licenses']);
  component.openCreateModal();
  assert.equal(component.isCreateModalOpen(), false);
});
