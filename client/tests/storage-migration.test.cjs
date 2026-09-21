const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');

function setup(t) {
  const requests = [];
  const dependencies = {
    ApiService: {
      create(url) { const stream = new rx.Subject(); requests.push({ url, stream }); return stream; },
      getFresh(url) { const stream = new rx.Subject(); requests.push({ url, stream }); return stream; },
    },
    ConfirmDialogService: { confirm: async () => true },
  };
  const module = { exports: {} };
  const decorator = () => () => {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/settings-page/storage-migration.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText, {
    module, exports: module.exports, console, setTimeout,
    require(name) {
      if (name === 'rxjs') return rx;
      if (name === '@angular/core') return { Component: decorator, Output: decorator, inject: key => dependencies[key],
        signal(value) { const read = () => value; read.set = next => { value = next; }; return read; },
        EventEmitter: class { count = 0; emit() { this.count++; } } };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const component = new module.exports.StorageMigrationComponent();
  t.after(() => component.ngOnDestroy());
  const job = (status = 'ready', extra = {}) => ({ id: 'job-1', status, bucket: 'test', switchedAt: null,
    counts: { total: 2, completed: 0, pending: 2, failed: 0, skipped: 0, expenses: 2, profiles: 0 }, issues: [], ...extra });
  component.job.set(job());
  const respond = (index, data) => { requests[index].stream.next({ data }); requests[index].stream.complete(); };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return { component, requests, dependencies, respond, job, tick };
}

test('cancelling confirmation never changes providers or starts a batch', async (t) => {
  const s = setup(t); s.dependencies.ConfirmDialogService.confirm = async () => false;
  await s.component.run(); assert.equal(s.requests.length, 0); assert.equal(s.component.running(), false);
});

test('pause finishes one in-flight record, then resume continues saved progress', async (t) => {
  const s = setup(t); const first = s.component.run(); await s.tick();
  assert.equal(s.requests.length, 1); s.component.pause();
  s.respond(0, s.job('running', { switchedAt: 'now' })); await first;
  assert.equal(s.requests.length, 1); assert.equal(s.component.running(), false);
  assert.equal(s.component.storageChanged.count, 1);
  const second = s.component.run(); await s.tick();
  s.respond(1, s.job('completed', { switchedAt: 'now' })); await second;
  assert.equal(s.requests.length, 2); assert.equal(s.component.job().status, 'completed');
});

test('failed records stop automatic processing and require an explicit retry', async (t) => {
  const s = setup(t); const run = s.component.run(); await s.tick();
  s.respond(0, s.job('needs_attention', { switchedAt: 'now' })); await run;
  assert.equal(s.requests.length, 1);
  const retry = s.component.run(true); assert.match(s.requests[1].url, /\/retry$/);
  s.respond(1, s.job('running', { switchedAt: 'now' })); await s.tick();
  assert.match(s.requests[2].url, /\/batch$/);
  s.respond(2, s.job('completed', { switchedAt: 'now' })); await retry;
});

test('navigation away prevents another batch after the current response', async (t) => {
  const s = setup(t); const run = s.component.run(); await s.tick(); s.component.ngOnDestroy();
  s.respond(0, s.job('running', { switchedAt: 'now' })); await run;
  assert.equal(s.requests.length, 1);
});

test('a dropped request preserves preview and exposes an error without retrying a write', async (t) => {
  const s = setup(t); const run = s.component.run(); await s.tick();
  s.requests[0].stream.error({ error: { message: 'Connection lost' } }); await run;
  assert.equal(s.requests.length, 1); assert.equal(s.component.job().id, 'job-1');
  assert.equal(s.component.error(), 'Connection lost'); assert.equal(s.component.running(), false);
  const refresh = s.component.load(); assert.match(s.requests[1].url, /\/latest$/);
  s.respond(1, s.job('running', { switchedAt: 'now' })); await refresh;
  assert.equal(s.component.job().status, 'running');
});
