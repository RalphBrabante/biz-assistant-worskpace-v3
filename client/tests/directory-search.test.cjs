const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject } = require('rxjs');

function setup(entity, className) {
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const api = { list(url) {
    const stream = new Subject();
    requests.push({ url, stream });
    return stream;
  } };
  const dependencies = {
    OrganizationContextService: { getActiveOrganizationId: () => 'org-a', isSuperuser: () => false },
  };
  const source = ts.transpileModule(fs.readFileSync(require.resolve(`../src/app/pages/${entity}-page/${entity}-page.component.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, URLSearchParams,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === '@angular/core') return {
        Component: () => value => value,
        inject: key => dependencies[key],
        computed: fn => fn,
        signal(value) { const read = () => value; read.set = next => { value = next; }; return read; },
      };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const Component = module.exports[className];
  Component.prototype.newVendorFormGroup = () => ({});
  Component.prototype.newCustomerFormGroup = () => ({});
  Component.prototype.persistTablePreferences = () => {};
  const page = new Component(api, {});
  const flush = () => {
    const pending = [...timers.values()]; timers.clear();
    pending.forEach(({ fn, delay }) => { assert.equal(delay, 300); fn(); });
  };
  return { page, requests, timers, flush };
}

for (const [entity, className] of [['vendors', 'VendorsPageComponent'], ['customers', 'CustomersPageComponent']]) {
  test(`${entity}: typing sends one search and cancels stale results immediately`, () => {
    const { page, requests, timers, flush } = setup(entity, className);
    page.load();
    page.page = 3;
    for (const query of ['a', 'ac', 'acme']) page.onFilterChange(query);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].stream.observers.length, 0);
    assert.equal(timers.size, 1);
    assert.equal(page.loading(), true);
    requests[0].stream.next({ data: [{ id: 'stale' }], meta: { page: 3 } });
    assert.equal(page.rows().length, 0);
    flush();
    assert.equal(requests.length, 2);
    const params = new URL(requests[1].url, 'http://test').searchParams;
    assert.equal(params.get('q'), 'acme');
    assert.equal(params.get('page'), '1');
    requests[1].stream.next({ data: [{ id: 'latest' }], meta: { total: 1 } });
    assert.equal(page.rows()[0].id, 'latest');
    assert.equal(page.loading(), false);
    page.onFilterChange('acme ');
    flush();
    assert.equal(requests.length, 2);
    page.ngOnDestroy();
  });

  test(`${entity}: clear, page size, errors and teardown handle pending searches`, () => {
    const { page, requests, timers, flush } = setup(entity, className);
    page.onFilterChange('acme');
    page.clearFilters();
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url, 'http://test').searchParams.has('q'), false);
    assert.equal(timers.size, 0);
    page.onFilterChange('new');
    page.onPageSizeChange('50');
    flush();
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1].url, 'http://test').searchParams.get('limit'), '50');
    requests[1].stream.error({ error: { message: 'Try again' } });
    assert.equal(page.loading(), false);
    assert.equal(page.error(), 'Try again');
    page.load();
    page.ngOnDestroy();
    assert.equal(requests[2].stream.observers.length, 0);
    const second = setup(entity, className);
    second.page.onFilterChange('pending');
    second.page.ngOnDestroy(); second.flush();
    assert.equal(second.requests.length, 0);
  });
}
