const { test } = require('node:test');
const { addOrganizationRoleFakes } = require('./helpers/organization-role-fakes');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Swap the database layer for in-memory fixtures before any controller loads it
let models = {};
const sequelizePath = require.resolve('../src/sequelize');
require.cache[sequelizePath] = { id: sequelizePath, filename: sequelizePath, loaded: true, exports: { getModels: () => models } };

const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'security-hardening-'));
process.env.UPLOAD_DIR = uploadRoot;

const usersController = require('../src/controllers/users-controller');
const rolesController = require('../src/controllers/roles-controller');
const { requireGlobalRoleAdministrator } = require('../src/services/role-access');
const { uploadExpenseImage } = require('../src/middleware/upload');
const { createUploadsStatic } = require('../src/middleware/uploads-static');
const { rateLimit } = require('../src/middleware/rate-limit');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c30000000049454e44ae426082', 'hex');

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    end() { return this; },
  };
}

function adminRequest(roleCodes, extra = {}) {
  return { auth: { userId: 'actor', roleCodes, user: { id: 'actor', organizationId: 'org' } }, params: { id: 'target' }, body: {}, query: {}, ...extra };
}

function roleFixture(role) {
  const grants = [];
  models = {
    User: { findOne: async () => ({ id: 'target', organizationId: 'org' }) },
    Role: { findOne: async () => role, findByPk: async () => role },
    UserRole: { findOrCreate: async ({ where }) => { grants.push(where); return [where]; } },
    OrganizationUser: { findOne: async ({ where }) => ({ userId: where.userId, isActive: true, role: 'member', update: async () => {} }) },
  };
  // Everything except superuser is granted through the organization's own copy of the role.
  addOrganizationRoleFakes(models, { onAssign: (payload) => grants.push(payload) });
  return grants;
}

test('an organization administrator cannot rename the superuser role to grant it to themselves', async () => {
  // Global role writes are superuser-only at the route
  const res = response();
  let reached = false;
  requireGlobalRoleAdministrator(adminRequest(['administrator']), res, () => { reached = true; });
  assert.equal(reached, false);
  assert.equal(res.statusCode, 403);

  // Even a renamed superuser role (code no longer "superuser") is not grantable by an administrator
  const grants = roleFixture({ id: 'super-role', code: 'x', isActive: true });
  const grantRes = response();
  await usersController.addRoleToUser(adminRequest(['administrator'], { body: { roleId: 'super-role' } }), grantRes);
  assert.equal(grantRes.statusCode, 403);
  assert.equal(grants.length, 0);
});

test('global role and license write routes require a superuser', () => {
  for (const file of ['roles-routes', 'permissions-routes', 'licenses-routes', 'tax-types-routes']) {
    const router = require(`../src/routes/${file}`);
    for (const layer of router.stack) {
      const methods = Object.keys(layer.route.methods);
      if (methods.includes('get')) continue;
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.ok(handlers.includes(requireGlobalRoleAdministrator), `${file} ${methods} ${layer.route.path} must be superuser-only`);
    }
  }
});

test('role grants are capped at the requester’s own level', async () => {
  for (const [requester, code, allowed] of [
    [['administrator'], 'administrator', true],
    [['administrator'], 'enduser', true],
    [['enduser'], 'administrator', false],
    [['administrator'], 'superuser', false],
    [['administrator'], 'custom-global-role', false],
    [['superuser'], 'superuser', true],
    // Changing roles is an administrator action, so nobody can promote themselves with users.update.
    [['enduser'], 'enduser', false],
  ]) {
    const grants = roleFixture({ id: 'role', code, isActive: true });
    const res = response();
    // eslint-disable-next-line no-await-in-loop
    await usersController.addRoleToUser(adminRequest(requester, { body: { roleId: 'role' } }), res);
    assert.equal(res.statusCode === 201, allowed, `${requester} granting ${code}`);
    assert.equal(grants.length, allowed ? 1 : 0);
  }
});

test('system role codes cannot be renamed and system roles cannot be deactivated', async () => {
  const role = { id: 'super-role', code: 'superuser', isSystem: true, update: async () => assert.fail('must not update') };
  models = { Role: { findByPk: async () => role } };
  for (const body of [{ code: 'x' }, { isActive: false }]) {
    const res = response();
    // eslint-disable-next-line no-await-in-loop
    await rolesController.updateRole({ params: { id: 'super-role' }, body }, res);
    assert.equal(res.statusCode, 403);
  }
});

test('an administrator cannot set the password of a user who also belongs to another organization', async () => {
  const target = { id: 'target', email: 'shared@example.test', role: 'member', organizationId: 'org', update: async () => assert.fail('must not update') };
  models = {
    User: { findOne: async () => target },
    Role: {},
    UserRole: { findAll: async () => [] },
    OrganizationUser: { count: async () => 1, findOne: async () => ({ role: 'accountant' }) },
  };
  const res = response();
  await usersController.updateUser(adminRequest(['administrator'], { body: { password: 'NewPass123' } }), res);
  assert.equal(res.statusCode, 403);
});

test('an admin password change ends the target’s sessions and lifts their lockout', async () => {
  const revoked = [], cleared = [];
  const target = { id: 'target', email: 'staff@example.test', role: 'member', organizationId: 'org', toJSON() { return { id: 'target' }; }, update: async () => {} };
  models = {
    User: { findOne: async () => target },
    Role: {},
    UserRole: { findAll: async () => [] },
    OrganizationUser: { count: async () => 0, findOne: async () => ({ role: 'enduser' }) },
    Token: { update: async (_values, { where }) => { revoked.push(where); } },
    InvalidLoginAttempt: { destroy: async ({ where }) => { cleared.push(where); } },
  };
  const res = response();
  await usersController.updateUser(adminRequest(['administrator'], { body: { password: 'NewPass123' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual([...revoked[0].type], ['access', 'refresh', 'reset_password']);
  assert.equal(cleared[0].userId, 'target');
});

function runUpload(content, filename, mimetype) {
  return new Promise((resolve) => {
    const boundary = 'testboundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const server = http.createServer((req, res) => {
      uploadExpenseImage(req, res, (err) => {
        res.end(JSON.stringify({ error: err ? err.message : null, file: req.file || null }));
      });
    });
    server.listen(0, () => {
      const request = http.request({ port: server.address().port, method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { server.close(); resolve(JSON.parse(data)); });
      });
      request.end(body);
    });
  });
}

test('uploads that are not real images are rejected even when they claim an image type', async () => {
  const result = await runUpload(Buffer.from('<html><script>alert(localStorage.accessToken)</script></html>'), 'x.html', 'image/png');
  assert.match(result.error, /Only image files are allowed/);
  assert.deepEqual(fs.readdirSync(path.join(uploadRoot, 'expenses')), []);
});

test('a genuine image is stored under an extension taken from its contents, not its filename', async () => {
  const result = await runUpload(PNG, 'receipt.html', 'image/png');
  assert.equal(result.error, null);
  assert.equal(path.extname(result.file.filename), '.png');
  assert.equal(result.file.mimetype, 'image/png');
  assert.match(result.file.filename, /^expense-[a-f\d]{32}\.png$/);
});

test('/uploads never serves financial attachments or non-image files, and serves images inert', async () => {
  fs.mkdirSync(path.join(uploadRoot, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(uploadRoot, 'profiles', 'legacy.html'), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(uploadRoot, 'profiles', 'avatar.png'), PNG);
  const express = require('express');
  const app = express();
  app.use('/uploads', createUploadsStatic());
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const get = (url) => fetch(`http://127.0.0.1:${server.address().port}${url}`);
  try {
    const expense = fs.readdirSync(path.join(uploadRoot, 'expenses'))[0];
    assert.equal((await get(`/uploads/expenses/${expense}`)).status, 404);
    assert.equal((await get('/uploads/profiles/legacy.html')).status, 404);
    const avatar = await get('/uploads/profiles/avatar.png');
    assert.equal(avatar.status, 200);
    assert.equal(avatar.headers.get('x-content-type-options'), 'nosniff');
    assert.match(avatar.headers.get('content-security-policy'), /sandbox/);
  } finally {
    server.close();
  }
});

test('rate limiter rejects requests over the limit with Retry-After', async () => {
  const limiter = rateLimit({ name: `test-${Date.now()}`, windowMs: 60000, max: 2, key: () => 'same-client' });
  const statuses = [];
  for (let i = 0; i < 3; i += 1) {
    const res = response();
    // eslint-disable-next-line no-await-in-loop
    await limiter({}, res, () => { res.statusCode = 200; });
    statuses.push(res.statusCode);
    if (i === 2) assert.ok(Number(res.headers['Retry-After']) > 0);
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

const { Op } = require('sequelize');
const authController = require('../src/controllers/auth-controller');

// Minimal evaluator for the where-clauses the lockout logic issues
function matches(row, where) {
  // Reflect.ownKeys, not Object.entries: Sequelize operators such as Op.or are symbol keys
  return Reflect.ownKeys(where).every((key) => {
    const condition = where[key];
    if (key === Op.or) return condition.some((alternative) => matches(row, alternative));
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if (Op.gt in condition) return row[key] && row[key] > condition[Op.gt];
      if (Op.gte in condition) return row[key] && row[key] >= condition[Op.gte];
      if (Op.ne in condition) return row[key] !== condition[Op.ne] && row[key] !== undefined;
    }
    return row[key] === condition;
  });
}

function lockoutFixture() {
  const attempts = [];
  const user = { id: 'victim', email: 'victim@example.test', password: '$2a$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv', isActive: true, status: 'active', isEmailVerified: true };
  models = {
    User: { findOne: async () => user },
    InvalidLoginAttempt: {
      findOne: async ({ where }) => attempts.filter((row) => matches(row, where)).at(-1) || null,
      count: async ({ where }) => attempts.filter((row) => matches(row, where)).length,
      create: async (row) => { attempts.push({ ...row, createdAt: new Date() }); return row; },
      destroy: async () => {},
    },
  };
  return attempts;
}

const loginAs = async (ip, password = 'wrong-password') => {
  const res = response();
  await authController.login({ body: { email: 'victim@example.test', password }, ip, get: () => null }, res);
  return res.statusCode;
};

test('failed logins from one IP lock that IP only, so the owner elsewhere is not locked out', async () => {
  lockoutFixture();
  const attacker = [];
  for (let i = 0; i < 6; i += 1) attacker.push(await loginAs('203.0.113.9')); // eslint-disable-line no-await-in-loop
  assert.deepEqual(attacker, [401, 401, 401, 401, 401, 429]);
  // The victim's own IP is unaffected (401 = credentials checked, not 429 = locked)
  assert.equal(await loginAs('198.51.100.7'), 401);
});

test('distributed guessing across many IPs still locks the whole account', async () => {
  lockoutFixture();
  for (let i = 0; i < 20; i += 1) await loginAs(`203.0.113.${i}`); // eslint-disable-line no-await-in-loop
  assert.equal(await loginAs('198.51.100.7'), 429);
});

test('notification emails escape user-supplied values', async () => {
  const sent = [];
  process.env.SMTP2GO_API_KEY = 'test-key';
  const realFetch = global.fetch;
  global.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); const payload = { data: { succeeded: 1 } }; return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }; };
  try {
    const { sendOrderCreatedEmail } = require('../src/services/email-service');
    await sendOrderCreatedEmail({ toEmail: 'admin@example.test', toName: 'Admin', organizationName: 'Org', orderNumber: '<a href=https://phish.test>Verify</a>\r\nBcc: x@y', orderUrl: 'https://app.test/orders/1' });
  } finally {
    global.fetch = realFetch;
    delete process.env.SMTP2GO_API_KEY;
  }
  const html = sent[0].html_body || sent[0].html || '';
  assert.ok(!html.includes('<a href=https://phish.test>'), 'raw HTML must not reach the email body');
  assert.ok(html.includes('&lt;a href=https://phish.test&gt;'));
  assert.ok(!/[\r\n]/.test(sent[0].subject));
});

test('percent-encoded or dot-segment paths cannot reach private uploads', async () => {
  const express = require('express');
  const app = express();
  app.use('/uploads', createUploadsStatic());
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const expense = fs.readdirSync(path.join(uploadRoot, 'expenses'))[0];
  try {
    for (const url of [`/uploads/%65xpenses/${expense}`, `/uploads/EXPENSES/${expense}`, `/uploads/profiles/../expenses/${expense}`, `/uploads/profiles/%2e%2e/expenses/${expense}`, '/uploads/%E0%A4%A']) {
      // eslint-disable-next-line no-await-in-loop
      const status = (await fetch(`http://127.0.0.1:${server.address().port}${url}`)).status;
      assert.ok(status === 404 || status === 400, `${url} returned ${status}`);
    }
  } finally {
    server.close();
  }
});

test('the owner signing in elsewhere does not lift an attacker IP lock', async () => {
  const attempts = lockoutFixture();
  const bcrypt = require('bcryptjs');
  models.User.findOne = async () => ({ id: 'victim', email: 'victim@example.test', password: bcrypt.hashSync('Correct123', 4), isActive: true, status: 'inactive', isEmailVerified: true });
  models.InvalidLoginAttempt.destroy = async ({ where }) => {
    for (let i = attempts.length - 1; i >= 0; i -= 1) if (matches(attempts[i], where)) attempts.splice(i, 1);
  };
  for (let i = 0; i < 5; i += 1) await loginAs('203.0.113.9'); // eslint-disable-line no-await-in-loop
  await loginAs('198.51.100.7', 'Correct123'); // owner's correct password from another IP
  assert.equal(await loginAs('203.0.113.9'), 429);
});

test('your own email or password cannot be changed through the users endpoint', async () => {
  const self = { id: 'actor', email: 'me@example.test', role: 'member', update: async () => assert.fail('must not update') };
  models = { User: { findOne: async () => self }, Role: {}, UserRole: { findAll: async () => [] }, OrganizationUser: { count: async () => 0 } };
  for (const body of [{ password: 'NewPass123' }, { email: 'attacker@example.test' }]) {
    const res = response();
    // eslint-disable-next-line no-await-in-loop
    await usersController.updateUser(adminRequest(['superuser'], { params: { id: 'actor' }, body }), res);
    assert.equal(res.statusCode, 403);
  }
});

test('a client reaching Node directly cannot choose its own IP with X-Forwarded-For', async () => {
  const express = require('express');
  const { trustProxySetting } = require('../src/services/trust-proxy');
  const app = express();
  app.set('trust proxy', trustProxySetting(''));
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    // From loopback (trusted, like nginx) the forwarded address is honoured
    const viaProxy = await (await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers: { 'X-Forwarded-For': '203.0.113.5' } })).json();
    assert.equal(viaProxy.ip, '203.0.113.5');
  } finally {
    server.close();
  }
  // A public peer is never trusted, so its spoofed header is ignored
  const trust = app.get('trust proxy fn');
  assert.equal(trust('198.51.100.20', 0), false);
  assert.equal(trust('172.18.0.5', 0), true);
});

test('OAuth callbacks must come from the browser that started the flow, on the configured path', () => {
  const { bindToBrowser, isSameBrowser } = require('../src/services/oauth-browser-binding');
  process.env.APP_BASE_URL = 'https://app.example.test';
  const cookies = {};
  const res = { cookie(name, value, options) { cookies[name] = { value, options }; }, clearCookie() {} };
  bindToBrowser({ secure: true }, res, 'oauth', 'state-1', 'https://app.example.test/custom/callback');
  assert.equal(cookies.oauth.options.path, '/custom/callback');
  assert.equal(isSameBrowser({ headers: { cookie: 'oauth=state-1' } }, res, 'oauth', 'state-1', 'https://app.example.test/custom/callback'), true);
  assert.equal(isSameBrowser({ headers: {} }, res, 'oauth', 'state-1', 'https://app.example.test/custom/callback'), false);
  // A redirect URI on another host cannot carry the cookie, so binding is skipped instead of failing
  assert.equal(isSameBrowser({ headers: {} }, res, 'oauth', 'state-1', 'https://other.example.test/callback'), true);
});

test('expense attachments are only read from the expense folder and never when another organization owns the file', async () => {
  const expensesController = require('../src/controllers/expenses-controller');
  fs.mkdirSync(path.join(uploadRoot, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(uploadRoot, 'profiles', 'someone.png'), PNG);
  const ownFile = 'expense-own-receipt.png';
  fs.writeFileSync(path.join(uploadRoot, 'expenses', ownFile), PNG);
  const scenarios = [
    { url: `/uploads/expenses/${ownFile}`, claimedElsewhere: 0, status: 200 },
    { url: `/uploads/expenses/${ownFile}`, claimedElsewhere: 1, status: 404 },
    { url: '/uploads/profiles/someone.png', claimedElsewhere: 0, status: 404 },
    { url: '/uploads/expenses/../profiles/someone.png', claimedElsewhere: 0, status: 404 },
  ];
  for (const scenario of scenarios) {
    models = { Expense: { findOne: async () => ({ id: 'e1', organizationId: 'org', file: scenario.url }), count: async () => scenario.claimedElsewhere }, QuarterlyExpenseReport: {}, Vendor: {}, VendorOrganization: {}, Organization: {}, OrganizationUser: {}, TaxType: {}, WithholdingTaxType: {} };
    const res = { ...response(), set(headers) { this.headers = { ...this.headers, ...headers }; return this; }, send(body) { this.body = body; return this; } };
    // eslint-disable-next-line no-await-in-loop
    await expensesController.getExpenseAttachment(adminRequest(['enduser'], { params: { id: 'e1' } }), res);
    assert.equal(res.statusCode, scenario.status, JSON.stringify(scenario));
    if (scenario.status === 200) {
      assert.equal(res.headers['Content-Type'], 'image/png');
      assert.match(res.headers['Content-Security-Policy'], /sandbox/);
    }
  }
});

test('legacy receipts: public Spaces objects and Drive "anyone" links are made private, others left alone', async () => {
  const { S3Client } = require('@aws-sdk/client-s3');
  const { makeStoredFilePrivate } = require('../src/services/storage-service');
  const settings = {
    do_spaces_endpoint: 'https://sgp1.digitaloceanspaces.com', do_spaces_region: 'sgp1', do_spaces_bucket: 'gimo',
    do_spaces_access_key: 'k', do_spaces_secret_key: 's', do_spaces_directory: 'prod',
    google_drive_client_id: 'id', google_drive_client_secret: 'secret', google_drive_refresh_token: 'r',
    google_drive_access_token: 'token', google_drive_expiry_date: new Date(Date.now() + 3600e3).toISOString(),
  };
  models = { AppSetting: { findAll: async () => Object.entries(settings).map(([key, valueText]) => ({ key, valueText })) } };
  const aclCalls = [];
  const realSend = S3Client.prototype.send;
  S3Client.prototype.send = async function send(command) {
    const name = command.constructor.name, key = command.input.Key;
    if (name === 'GetObjectAclCommand') {
      if (key.endsWith('missing.png')) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Grants: key.endsWith('public.png') ? [{ Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' } }] : [] };
    }
    if (name === 'PutObjectAclCommand') { aclCalls.push(command.input); return {}; }
    throw new Error(`unexpected ${name}`);
  };
  const deleted = [];
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.includes('fields=name')) return json({ name: url.includes('/files/profile1') ? 'profiles-avatar.png' : 'expenses-expense-1.png' });
    if (url.includes('/permissions?')) return json({ permissions: [{ id: 'anyoneWithLink', type: 'anyone' }, { id: 'owner', type: 'user' }] });
    if (options.method === 'DELETE') { deleted.push(url); return json({}, 204); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const spaces = (name) => `https://gimo.sgp1.digitaloceanspaces.com/prod/expenses/${name}`;
  try {
    const run = (url, dryRun) => makeStoredFilePrivate(url, { folder: 'expenses', dryRun });
    assert.deepEqual(await run(spaces('public.png'), true), { provider: 'do_spaces', status: 'would_make_private' });
    assert.equal(aclCalls.length, 0, 'dry run must not change anything');
    assert.deepEqual(await run(spaces('public.png'), false), { provider: 'do_spaces', status: 'made_private' });
    assert.deepEqual(aclCalls, [{ Bucket: 'gimo', Key: 'prod/expenses/public.png', ACL: 'private' }]);
    assert.equal((await run(spaces('private.png'), false)).status, 'already_private');
    assert.equal((await run(spaces('missing.png'), false)).status, 'not_found');
    assert.equal((await run('https://gimo.sgp1.digitaloceanspaces.com/prod/profiles/a.png', false)).status, 'not_in_folder');
    assert.equal((await run('https://example.com/receipt.jpg', false)).status, 'not_in_folder');
    assert.equal((await run('/uploads/expenses/a.png', false)).status, 'already_private');
    assert.deepEqual(await run('https://drive.google.com/uc?id=expense1', false), { provider: 'google_drive', status: 'made_private' });
    assert.equal(deleted.length, 1);
    assert.match(deleted[0], /permissions\/anyoneWithLink/);
    assert.equal((await run('https://drive.google.com/uc?id=profile1', false)).status, 'not_in_folder');
  } finally {
    S3Client.prototype.send = realSend;
    global.fetch = realFetch;
  }
});
