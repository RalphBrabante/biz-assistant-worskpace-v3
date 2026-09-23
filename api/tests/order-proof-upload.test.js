const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const express = require('express');
const { authorize } = require('../src/middleware/authz');

test('order routes support JSON and optional multipart proof with permission and size checks', async t => {
  const filename = require.resolve('../src/routes/orders-routes'); const localRequire = createRequire(filename); const module = { exports: {} }; const calls = [];
  const controller = (req, res) => { calls.push({ body: req.body, file: req.file }); res.json({ ok: true }); };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require(name) {
    if (name === '../controllers/order-workflow-controller') return new Proxy({}, { get: () => controller });
    if (name === '../controllers/orders-controller') return { listOrders: controller };
    if (name === '../middleware/authz') return { authorize };
    return localRequire(name);
  } });
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.auth = { permissions: new Set((req.get('x-permissions') || '').split(',')) }; next(); }); app.use('/orders', module.exports);
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/orders`;
  const form = (payload = JSON.stringify({ poRequired: false, orderedItems: [{ name: 'Work', quantity: 1 }] }), size = 12) => { const data = new FormData(); data.append('payload', payload); data.append('document', new Blob([Buffer.alloc(size)], { type: 'application/pdf' }), 'proof.pdf'); return data; };
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-permissions': 'orders.create', 'Content-Type': 'application/json' }, body: JSON.stringify({ poRequired: false }) })).status, 200);
  assert.equal(calls.at(-1).file, undefined);
  for (const method of ['POST', 'PUT', 'PATCH']) {
    const response = await fetch(method === 'POST' ? url : `${url}/order-a`, { method, headers: { 'x-permissions': method === 'POST' ? 'orders.create' : 'orders.update' }, body: form() });
    assert.equal(response.status, 200); assert.equal(calls.at(-1).body.poRequired, false); assert.equal(calls.at(-1).body.orderedItems.length, 1); assert.equal(calls.at(-1).file.originalname, 'proof.pdf');
  }
  const stage = new FormData(); stage.append('document', new Blob(['%PDF-proof']), 'proof.pdf'); stage.append('organizationId', 'org-a'); stage.append('uploadId', 'upload-a'); stage.append('orderId', 'order-a');
  assert.equal((await fetch(`${url}/document-uploads`, { method: 'POST', headers: { 'x-permissions': 'orders.update' }, body: stage })).status, 200);
  assert.equal(calls.at(-1).body.orderId, 'order-a'); assert.equal(calls.at(-1).body.uploadId, 'upload-a'); assert.equal(calls.at(-1).file.originalname, 'proof.pdf');
  const before = calls.length;
  assert.equal((await fetch(url, { method: 'POST', body: form() })).status, 403);
  for (const payload of ['bad json', '[]', 'null']) assert.equal((await fetch(url, { method: 'POST', headers: { 'x-permissions': 'orders.create' }, body: form(payload) })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-permissions': 'orders.create' }, body: form('{}', 5 * 1024 * 1024 + 1) })).status, 400);
  const multiple = form(); multiple.append('document', new Blob(['another']), 'another.pdf');
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-permissions': 'orders.create' }, body: multiple })).status, 400);
  assert.equal(calls.length, before);
});
