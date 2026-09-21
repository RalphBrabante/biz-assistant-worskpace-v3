const { test } = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/storage-migration-controller');
const cache = require('../src/middleware/cache');

test('all migration endpoints reject non-superusers before accessing storage or the database', async () => {
  for (const roleCodes of [[], ['admin'], ['manager']]) {
    for (const name of ['latest', 'create', 'batch', 'retry', 'cancel', 'audit']) {
      const res = { status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
      await controller[name]({ auth: { roleCodes } }, res);
      assert.equal(res.statusCode, 403, name);
    }
  }
});

test('migration status and audits bypass the server read cache', async () => {
  for (const path of ['/settings/storage/migrations/latest', '/api/v1/settings/storage/migrations/id/audit']) {
    const headers = {}; let passed = false;
    const res = { set(key, value) { headers[key] = value; } };
    await cache.readCacheMiddleware({ method: 'GET', path }, res, () => { passed = true; });
    assert.equal(passed, true); assert.equal(headers['X-Cache'], 'BYPASS');
  }
});
