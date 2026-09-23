const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { MemoryCache } = require('../src/services/memory-cache');

function load(relativePath, mocks = {}, env = {}) {
  const filename = path.join(__dirname, '../src', relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, Date, process: { env },
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
  }, { filename });
  return module.exports;
}
function service(env = {}, setting = null) {
  return load('services/cache-service.js', {
    '../sequelize': { getModels: () => ({ AppSetting: { findOne: async () => setting } }) },
  }, env);
}
function request(overrides = {}) {
  return { originalUrl: '/api/v1/expenses', query: {}, get: () => undefined,
    auth: { userId: 'u1', user: { organizationId: 'org1' }, roleCodes: ['staff'], permissions: new Set(['expenses.read']) }, ...overrides };
}

test('memory expires without SQL, evicts least-recently-used entries and bounds bytes', () => {
  let now = 1000;
  const cache = new MemoryCache({ maxEntries: 2, maxBytes: 12, maxEntryBytes: 8, now: () => now });
  cache.set('a', '123', 1); cache.set('b', '456', 2);
  assert.equal(cache.get('a'), '123');
  cache.set('c', '789', 2);
  assert.equal(cache.get('b'), null);
  assert.equal(cache.entries.size, 2);
  now = 2000;
  assert.equal(cache.get('a'), null);
  cache.set('large', 'x'.repeat(10), 1);
  assert.equal(cache.get('large'), null);
  cache.set('d', '123456', 2);
  cache.set('e', '123456', 2);
  assert.equal(cache.get('d'), null);
  assert.ok(cache.bytes <= 12);
  cache.clear(); assert.equal(cache.bytes, 0);
});

test('memory fallback caches serialized data and honors the saved disable setting', async () => {
  const cache = service();
  assert.equal(cache.getCacheStatus().backend, 'memory');
  const value = { status: 200, body: { amount: 10 } };
  await cache.setCachedJson('expenses', value);
  value.body.amount = 20;
  const hit = await cache.getCachedJson('expenses');
  assert.equal(hit.body.amount, 10);
  hit.body.amount = 30;
  assert.equal((await cache.getCachedJson('expenses')).body.amount, 10);
  await cache.setCacheEnabled(false);
  assert.equal(cache.getCacheStatus().backend, 'disabled');
  assert.equal(await cache.getCachedJson('expenses'), null);
  await cache.setCacheEnabled(true);
  assert.equal(await cache.getCachedJson('expenses'), null);
  const disabled = service({}, { valueBoolean: false });
  await disabled.initializeCacheConfig();
  assert.equal(disabled.getCacheEnabled(), false);
});

test('keys isolate identities, effective organizations, selected organizations, permissions and filters', () => {
  const cache = service(); const base = request(); const key = cache.buildCacheKey(base);
  for (const change of [
    { auth: { ...base.auth, userId: 'u2' } },
    { auth: { ...base.auth, user: { organizationId: 'org2' } } },
    { auth: { ...base.auth, roleCodes: ['administrator'], isPrivileged: true } },
    { auth: { ...base.auth, permissions: new Set() } },
    { get: () => 'org2' }, { query: { page: '2' } },
    { originalUrl: '/api/v1/reports' },
  ]) assert.notEqual(cache.buildCacheKey(request(change)), key);
  assert.equal(cache.buildCacheKey(request({ query: { a: '1', b: '2' } })), cache.buildCacheKey(request({ query: { b: '2', a: '1' } })));
  assert.notEqual(cache.buildCacheKey(request({ query: { q: ['a', 'b'] } })), cache.buildCacheKey(request({ query: { q: 'a,b' } })));
  assert.notEqual(cache.buildCacheKey(request({ query: { q: { a: '1' } } })), cache.buildCacheKey(request({ query: { q: { b: '1' } } })));
});

test('writes invalidate totals even without a count change and reject an in-flight stale fill', async () => {
  const cache = service(); const version = await cache.getCacheVersion();
  await cache.setCachedJson('total', { count: 2, total: 10 }, undefined, version);
  await cache.clearAllApiCache();
  await cache.setCachedJson('total', { count: 2, total: 10 }, undefined, version);
  assert.equal(await cache.getCachedJson('total'), null);
  await cache.setCachedJson('total', { count: 2, total: 20 });
  assert.equal((await cache.getCachedJson('total')).total, 20);
});

test('Redis generations invalidate across processes and isolate delayed fills', async () => {
  const data = new Map();
  const redis = { status: 'ready', get: async (key) => data.get(key), set: async (key, value) => data.set(key, value) };
  const first = service(); const second = service(); first.setRedisClient(redis); second.setRedisClient(redis);
  const oldVersion = await first.getCacheVersion();
  await first.setCachedJson('total', { amount: 10 }, undefined, oldVersion);
  assert.equal((await second.getCachedJson('total')).amount, 10);
  await second.clearAllApiCache();
  await first.setCachedJson('total', { amount: 10 }, undefined, oldVersion);
  assert.equal(await second.getCachedJson('total'), null);
  assert.equal(await first.getCachedJson('total'), null);
});

test('Redis failures and disconnections fall back without waiting on an offline queue', async () => {
  const cache = service();
  cache.setRedisClient({ status: 'ready', get: async () => { throw Error('offline'); }, set: async () => { throw Error('offline'); } });
  const fallbackVersion = await cache.getCacheVersion();
  await cache.setCachedJson('total', { amount: 10 }, undefined, fallbackVersion);
  assert.equal(cache.getCacheStatus().backend, 'memory');
  assert.equal((await cache.getCachedJson('total')).amount, 10);
  cache.setRedisClient({ status: 'reconnecting', set: () => { throw Error('must not queue'); } });
  await cache.clearAllApiCache();
  await cache.setCachedJson('total', { amount: 20 });
  assert.equal((await cache.getCachedJson('total')).amount, 20);
});

test('configuration rejects invalid bounds, caps limits, and skips oversized responses', async () => {
  const cache = service({ API_CACHE_TTL_SECONDS: '-1', API_CACHE_MAX_ENTRIES: '100000', API_CACHE_MAX_BYTES: 'NaN', API_CACHE_MAX_ENTRY_BYTES: '100' });
  const status = cache.getCacheStatus();
  assert.equal(status.ttlSeconds, 60); assert.equal(status.maxEntries, 10000); assert.equal(status.maxBytes, 33554432);
  await cache.setCachedJson('large', { text: 'x'.repeat(101) });
  assert.equal(await cache.getCachedJson('large'), null);
});

for (const [resource, permission, writeNames] of [
  ['expenses', 'expenses', ['updateExpense', 'importExpenses']],
  ['vendors', 'vendors', ['updateVendor', 'importVendors']],
  ['customers', 'organizations', ['updateCustomer', 'importCustomers']],
]) {
test(`real ${resource} router caches searches, rechecks permissions, and invalidates before write responses`, async (t) => {
  const express = require('express');
  const cache = service();
  const middleware = load('middleware/cache.js', { '../services/cache-service': cache });
  const { authorize } = require('../src/middleware/authz');
  let businessReads = 0; let authChecks = 0; let amount = 10;
  const read = (_req, res) => { businessReads++; res.json({ count: 1, amount }); };
  const write = (req, res) => { amount = Number(req.body.amount); res.status(req.body.fail ? 500 : 204).end(); };
  const controllers = new Proxy({}, { get: (_target, name) => writeNames.includes(name) ? write : read });
  const router = load(`routes/${resource}-routes.js`, {
    [`../controllers/${resource}-controller`]: controllers,
    '../middleware/authz': { authorize },
    '../middleware/cache': middleware,
    '../middleware/upload': { uploadExpenseImage: (_q, _s, next) => next(), uploadImportCsv: (_q, _s, next) => next() },
  });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    authChecks++;
    req.auth = request().auth;
    req.auth.userId = req.get('x-test-user') || 'u1';
    req.auth.user.organizationId = req.get('x-test-org') || 'org1';
    if (req.get('x-test-denied')) req.auth.permissions = new Set();
    else req.auth.permissions.add(`${permission}.read`).add(`${permission}.update`).add(`${permission}.create`);
    next();
  });
  app.use(middleware.invalidateCacheOnWriteMiddleware);
  app.use(`/api/v1/${resource}`, router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/${resource}`;
  const get = (headers = {}) => fetch(`${url}?q=acme&limit=20`, { headers });
  assert.equal((await get()).headers.get('x-cache'), 'MISS');
  const hit = await get(); assert.equal(hit.headers.get('x-cache'), 'HIT');
  assert.equal((await hit.json()).amount, 10); assert.equal(businessReads, 1); assert.equal(authChecks, 2);
  assert.equal((await get({ 'x-test-denied': '1' })).status, 403); assert.equal(businessReads, 1);
  assert.equal((await fetch(`${url}?q=different&limit=20`)).headers.get('x-cache'), 'MISS');
  assert.equal((await get({ 'x-test-org': 'org2' })).headers.get('x-cache'), 'MISS');
  assert.equal((await get({ 'x-test-user': 'u2' })).headers.get('x-cache'), 'MISS');
  assert.equal((await get({ 'Cache-Control': 'no-cache' })).headers.get('x-cache'), 'BYPASS');
  for (const fail of [false, true]) {
    amount = 10; await cache.clearAllApiCache(); await get();
    await fetch(`${url}/expense-1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 20, fail }) });
    const fresh = await get(); assert.equal(fresh.headers.get('x-cache'), 'MISS');
    assert.equal((await fresh.json()).amount, 20);
  }
  await cache.setCacheEnabled(false);
  assert.equal((await get()).headers.get('x-cache'), 'BYPASS');
});
}
