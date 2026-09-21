const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('../api/node_modules/express');
const { installFrontend } = require('../api/src/middleware/frontend');
const { validateEnvironment } = require('../scripts/runtime-config.cjs');
const { serviceEnabled, servicesHealthy } = require('../api/src/services/runtime-services');

test('deployment config rejects missing credentials and ephemeral upload directories', () => {
  const env = { NODE_ENV: 'production', DB_HOST: 'localhost', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test', APP_BASE_URL: 'https://app.example.com', UPLOAD_DIR: '/shared/uploads' };
  assert.doesNotThrow(() => validateEnvironment(env, '/release'));
  for (const patch of [{ DB_PASSWORD: '' }, { UPLOAD_DIR: 'uploads' }, { UPLOAD_DIR: '/release/uploads' }, { UPLOAD_DIR: '/home/user/hbuilds/current/uploads' }, { RUN_MIGRATIONS: 'yes' }, { NODE_ENV: 'development' }, { APP_BASE_URL: 'http://app.example.com' }]) {
    assert.throws(() => validateEnvironment({ ...env, ...patch }, '/release'));
  }
});

test('upload path placeholders produce an actionable error before filesystem access', () => {
  const env = { NODE_ENV: 'production', DB_HOST: 'localhost', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test', APP_BASE_URL: 'https://app.example.com' };
  for (const account of ['replace_account', 'YOUR_ACCOUNT']) {
    assert.throws(() => validateEnvironment({ ...env, UPLOAD_DIR: `/home/${account}/domains/app.gimosupplies.com/app-data/uploads` }, '/release'), /UPLOAD_DIR still contains an example account name/);
  }
  assert.doesNotThrow(() => validateEnvironment({ ...env, UPLOAD_DIR: '/home/u123456789/domains/app.example.com/app-data/uploads' }, '/release'));
});

test('optional infrastructure can be disabled, while enabled failures remain unhealthy', () => {
  assert.equal(serviceEnabled('REDIS', { NODE_ENV: 'production' }), false);
  assert.equal(serviceEnabled('REDIS', { NODE_ENV: 'development' }), true);
  assert.equal(serviceEnabled('REDIS', { NODE_ENV: 'production', REDIS_URL: 'redis://remote' }), true);
  assert.equal(serviceEnabled('REDIS', { REDIS_URL: 'redis://remote', REDIS_ENABLED: 'false' }), false);
  assert.equal(servicesHealthy({ mysql: true, redis: 'disabled', amqp: 'disabled' }), true);
  assert.equal(servicesHealthy({ mysql: false, redis: 'disabled', amqp: 'disabled' }), false);
  assert.equal(servicesHealthy({ mysql: true, redis: false, amqp: true }), false);
  assert.equal(servicesHealthy({ mysql: true }), false);
});

test('combined server serves deep links and assets without swallowing API or upload failures', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-frontend-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html>application</html>');
  fs.writeFileSync(path.join(root, 'main.js'), 'console.log("asset");');
  fs.writeFileSync(path.join(root, '.env'), 'must-not-be-served');
  const app = express();
  installFrontend(app, root);
  app.get('/api/v1/protected', (_req, res) => res.status(401).json({ error: 'Unauthorized' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/dashboard', '/expenses/create']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(await response.text(), /application/);
  }
  assert.match(await (await fetch(base + '/main.js')).text(), /asset/);
  assert.equal((await fetch(base + '/api/v1/protected')).status, 401);
  assert.deepEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
  for (const route of ['/api/unknown', '/uploads/missing', '/socket.io/unknown', '/missing.js', '/.env', '/.git/config']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(base + '/dashboard', { method: 'POST' })).status, 404);
});
