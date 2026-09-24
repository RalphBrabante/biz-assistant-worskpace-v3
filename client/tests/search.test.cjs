const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject, of, throwError } = require('rxjs');
const { TestScheduler } = require('rxjs/testing');

// Exercise the actual TypeScript streams and component handlers without a browser.
// Angular templates are checked separately by the production build.
function loadSource(relativePath, dependencies = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require, module, exports) { ${outputText}\n})`, { filename });
  run((name) => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('rxjs')) return require(name);
    if (name === '@angular/core') return { Component: () => (target) => target };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}
const search = loadSource('src/app/core/latest-search.ts');
const { latestSearch } = search;
const scheduler = () => new TestScheduler((actual, expected) => assert.deepEqual(actual, expected));

function signal(value) {
  const read = () => value;
  read.set = (next) => { value = next; };
  return read;
}

function component(name, folder) {
  return loadSource(`src/app/pages/${folder}/${folder}.component.ts`, {
    '../../core/latest-search': search,
    '@angular/common': {}, '@angular/forms': {}, '@angular/router': {},
    '../../core/api.service': {}, '../../core/auth.service': {},
    '../../core/confirm-dialog.service': {}, '../../core/organization-context.service': {},
    '../../core/table-preferences': {}, '../../shared/tooltip.directive': {},
    '../../core/expense-calculation': {}, '../../shared/country-select.component': {},
    '../../shared/countries': {}, '../../shared/modal.directive': {},
    '../../shared/dropdown.directive': {}, '../../shared/organization-required.component': {},
  })[name];
}

const Expenses = component('ExpensesPageComponent', 'expenses-page');
function expenses(api) {
  const page = Object.create(Expenses.prototype);
  Object.defineProperty(page, 'currentOrganizationId', { value: 'org-a' });
  Object.defineProperty(page, 'isContextLocked', { value: false });
  Object.assign(page, {
    api, vendorSearchInput$: new Subject(),
    dashboardRoute: { snapshot: { queryParamMap: { get: () => null } } },
    restoreTablePreferences() {}, loadWithholdingTaxTypes() {}, loadOrganizationTaxInfo() {}, load() {}, setupExpenseAutoCompute() {},
    newCreateExpenseForm: () => ({ patchValue() {}, get: () => ({ markAsTouched() {}, updateValueAndValidity() {} }) }),
    newVendorCreateForm: () => ({}),
  });
  for (const name of ['loadingVendors', 'vendorSearchFailed', 'vendorDropdownOpen', 'isCreateModalOpen', 'isVendorCreateModalOpen']) page[name] = signal(false);
  for (const name of ['vendorSearch', 'vendorCreateError', 'createModalError', 'createFileName', 'error', 'message']) page[name] = signal('');
  page.vendors = signal([]);
  page.selectedCreateVendor = signal(null);
  page.createExpenseForm = page.newCreateExpenseForm();
  page.ngOnInit();
  return page;
}

test('loading starts immediately and rapid typing sends only the final normalized query', () => {
  scheduler().run(({ hot, cold, expectObservable }) => {
    const requests = [];
    const states = hot('a-b-c----------|', { a: 'gl', b: 'glo', c: ' globe ' }).pipe(latestSearch((q) => {
      requests.push(q);
      return cold('--r|', { r: ['Globe'] });
    }, 5));
    expectObservable(states).toBe('l-l-l------s---|', {
      l: { status: 'loading', results: [] }, s: { status: 'success', results: ['Globe'] },
    });
    // Assert after the scheduled requests execute.
    hot('--------------x|').subscribe(() => assert.deepEqual(requests, ['globe']));
  });
});

test('a new keystroke cancels the old response before the debounce delay ends', () => {
  scheduler().run(({ hot, cold, expectObservable, expectSubscriptions }) => {
    const old = cold('-----r|', { r: [] });
    const current = cold('--r|', { r: ['Globe'] });
    const states = hot('a-----b-----------|', { a: 'wrong', b: 'globe' }).pipe(latestSearch((q) => q === 'wrong' ? old : current, 4));
    expectObservable(states).toBe('l-----l-----s-----|', {
      l: { status: 'loading', results: [] }, s: { status: 'success', results: ['Globe'] },
    });
    expectSubscriptions(old.subscriptions).toBe('----^-!');
  });
});

for (const reset of ['', 'g']) {
  test(`clearing or shortening input (${JSON.stringify(reset)}) cancels in-flight results`, () => {
    scheduler().run(({ hot, cold, expectObservable, expectSubscriptions }) => {
      const response = cold('-----r|', { r: ['Globe'] });
      const states = hot('a-----b------|', { a: 'globe', b: reset }).pipe(latestSearch(() => response, 4));
      expectObservable(states).toBe('l-----i------|', {
        l: { status: 'loading', results: [] }, i: { status: 'idle', results: [] },
      });
      expectSubscriptions(response.subscriptions).toBe('----^-!');
    });
  });
}

test('failures are distinct from successful empty results and the same query can retry', () => {
  scheduler().run(({ hot, expectObservable }) => {
    let attempts = 0;
    const states = hot('a----a----b----|', { a: 'globe', b: 'missing' }).pipe(latestSearch(() => {
      attempts++;
      return attempts === 1 ? throwError(() => new Error('offline')) : of(attempts === 2 ? ['Globe'] : []);
    }, 2));
    expectObservable(states).toBe('l-e--l-s--l-z--|', {
      l: { status: 'loading', results: [] }, e: { status: 'error', results: [] },
      s: { status: 'success', results: ['Globe'] }, z: { status: 'success', results: [] },
    });
  });
});

test('destroying the subscription cancels a pending request', () => {
  scheduler().run(({ hot, cold, expectObservable, expectSubscriptions }) => {
    const response = cold('------r|', { r: ['Globe'] });
    const states = hot('a', { a: 'globe' }).pipe(latestSearch(() => response, 2));
    expectObservable(states, '-----!').toBe('l', { l: { status: 'loading', results: [] } });
    expectSubscriptions(response.subscriptions).toBe('--^--!');
  });
});

for (const reset of ['clear input', 'clear selection', 'reopen modal']) {
  test(`expense vendor search repeats after ${reset}, even inside the debounce window`, () => {
    const clock = scheduler();
    clock.run(() => {
      const urls = [];
      const page = expenses({ list(url) { urls.push(url); return of({ data: [{ id: 'v1', name: 'Globe' }] }); } });
      page.onVendorSearchChange('globe');
      assert.equal(page.loadingVendors(), true);
      clock.schedule(() => {
        assert.equal(page.vendors()[0].name, 'Globe');
        if (reset === 'clear input') page.onVendorSearchChange('');
        if (reset === 'clear selection') {
          page.selectVendor(page.vendors()[0]);
          page.clearSelectedVendor();
        }
        if (reset === 'reopen modal') {
          page.closeCreateModal();
          page.openCreateModal();
        }
        page.onVendorSearchChange('globe');
        assert.equal(page.loadingVendors(), true);
        assert.deepEqual(page.vendors(), []);
      }, 400);
      clock.schedule(() => {
        assert.equal(urls.length, 2);
        assert.equal(page.vendors()[0].name, 'Globe');
        assert.equal(page.loadingVendors(), false);
        const params = new URL(urls[1], 'http://test').searchParams;
        assert.equal(params.get('q'), 'globe');
        assert.equal(params.get('organizationId'), 'org-a');
        assert.equal(params.get('activeOnly'), 'true');
        page.ngOnDestroy();
      }, 800);
    });
  });
}

test('expense vendor failure shows an error and retrying unchanged text recovers', () => {
  const clock = scheduler();
  clock.run(() => {
    let attempts = 0;
    const page = expenses({ list() { return ++attempts === 1 ? throwError(() => new Error('offline')) : of({ data: [{ name: 'Globe' }] }); } });
    page.onVendorSearchChange('globe');
    clock.schedule(() => {
      assert.equal(page.vendorSearchFailed(), true);
      assert.equal(page.loadingVendors(), false);
      page.onVendorSearchChange('globe');
      assert.equal(page.vendorSearchFailed(), false);
      assert.equal(page.loadingVendors(), true);
    }, 400);
    clock.schedule(() => {
      assert.equal(page.vendors()[0].name, 'Globe');
      assert.equal(page.vendorSearchFailed(), false);
      page.ngOnDestroy();
    }, 800);
  });
});

test('closing the expense modal cancels a request before its response arrives', () => {
  const clock = scheduler();
  clock.run(({ cold }) => {
    const page = expenses({ list: () => cold('100ms r|', { r: { data: [{ name: 'Globe' }] } }) });
    page.onVendorSearchChange('globe');
    clock.schedule(() => page.closeCreateModal(), 400);
    clock.schedule(() => {
      assert.deepEqual(page.vendors(), []);
      assert.equal(page.loadingVendors(), false);
      page.ngOnDestroy();
    }, 500);
  });
});

const Items = component('ItemsPageComponent', 'items-page');
for (const field of ['filter', 'edit']) {
  test(`items ${field} vendor search retries after clearing and distinguishes failures`, () => {
    const clock = scheduler();
    clock.run(() => {
      const page = Object.create(Items.prototype);
      for (const [name, value] of Object.entries({ currentOrganizationId: 'org-a', isContextLocked: false, canReadOrganizations: false })) {
        Object.defineProperty(page, name, { value });
      }
      let attempts = 0;
      Object.assign(page, {
        api: { list: () => ++attempts === 1 ? throwError(() => new Error('offline')) : of({ data: [{ id: 'v1', name: 'Globe' }] }) },
        restoreTablePreferences() {}, persistTablePreferences() {}, load() {},
        vendorFilterSearchInput$: new Subject(), editVendorSearchInput$: new Subject(),
        editForm: { organizationId: 'org-b' },
      });
      for (const name of ['loadingVendorFilter', 'vendorFilterSearchFailed', 'loadingEditVendors', 'editVendorSearchFailed']) page[name] = signal(false);
      for (const name of ['organizations', 'vendorFilterResults', 'editVendors']) page[name] = signal([]);
      for (const name of ['selectedVendorFilter', 'selectedEditVendor']) page[name] = signal(null);
      page.ngOnInit();
      const input = (value) => field === 'filter' ? page.onVendorFilterSearchChange(value) : page.onEditVendorSearchChange(value);
      const failed = field === 'filter' ? page.vendorFilterSearchFailed : page.editVendorSearchFailed;
      const loading = field === 'filter' ? page.loadingVendorFilter : page.loadingEditVendors;
      const results = field === 'filter' ? page.vendorFilterResults : page.editVendors;
      input('globe');
      assert.equal(loading(), true);
      clock.schedule(() => {
        assert.equal(failed(), true);
        input('globe');
      }, 300);
      clock.schedule(() => {
        assert.equal(results()[0].name, 'Globe');
        if (field === 'filter') {
          page.selectVendorFilter(results()[0]);
          page.clearVendorFilter();
        } else {
          page.selectEditVendor(results()[0]);
          page.clearEditVendorSelection();
        }
        input('globe');
        assert.equal(loading(), true);
      }, 600);
      clock.schedule(() => {
        assert.equal(attempts, 3);
        assert.equal(results()[0].name, 'Globe');
        assert.equal(failed(), false);
        page.ngOnDestroy();
      }, 900);
    });
  });
}

const Orders = component('CreateOrderPageComponent', 'create-order-page');
test('customer search retries identical text, resets after selection, and uses the current organization', () => {
  const clock = scheduler();
  clock.run(() => {
    const page = Object.create(Orders.prototype);
    let organizationId = 'org-a';
    Object.defineProperty(page, 'currentOrganizationId', { get: () => organizationId });
    const urls = [];
    page.api = { list(url) {
      urls.push(url);
      return urls.length === 1 ? throwError(() => new Error('offline')) : of({ data: [{ id: 'c1', name: 'Globe' }] });
    } };
    page.customerSearchInput$ = new Subject();
    page.setupCustomerSearch();
    page.onCustomerSearchInput('globe');
    assert.equal(page.searchingCustomers, true);
    clock.schedule(() => {
      assert.equal(page.customerSearchFailed, true);
      page.onCustomerSearchInput('globe');
    }, 350);
    clock.schedule(() => {
      page.selectCustomer(page.customerResults[0]);
      page.clearCustomer();
      organizationId = 'org-b';
      page.onCustomerSearchInput('globe');
      assert.equal(page.searchingCustomers, true);
    }, 700);
    clock.schedule(() => {
      assert.equal(page.customerResults[0].name, 'Globe');
      assert.equal(page.customerSearchFailed, false);
      assert.equal(urls.length, 3);
      assert.equal(new URL(urls[2], 'http://test').searchParams.get('organizationId'), 'org-b');
      page.ngOnDestroy();
    }, 1050);
  });
});
