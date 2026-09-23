const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { authorize } = require('../src/middleware/authz');
test('order readers and creators can load withholding options without expense access, but cannot modify tax configuration', () => {
  const routes = [];
  const router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (path, ...handlers) => routes.push({ method, path, handlers })]));
  const noop = (_req, _res, next) => next();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/withholding-tax-types-routes'), 'utf8'), { module, exports: module.exports, require(name) {
    if (name === 'express') return { Router: () => router };
    if (name.includes('authz')) return { authorize };
    return new Proxy({}, { get: () => noop });
  } });
  for (const permission of ['orders.read', 'orders.create', 'orders.update']) {
    for (const route of routes) {
      let allowed = false;
      const res = { status(code) { this.code = code; return this; }, json() {} };
      route.handlers[0]({ auth: { permissions: new Set([permission]) } }, res, () => { allowed = true; });
      assert.equal(allowed, route.method === 'get');
    }
  }
});
