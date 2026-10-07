const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');

function setup({ isActive = true, status = 'active', missing = false, destroyFailure = false } = {}) {
  const filename = require.resolve('../src/controllers/users-controller'), actual = createRequire(filename);
  const transaction = { LOCK: { UPDATE: 'UPDATE' } }, lookups = [], cleaned = [];
  let deleted = false, committed = false;
  const user = { id: 'target', organizationId: 'org', isActive, status,
    profileImageUrl: 'https://example.test/avatar', profileImageCdnUrl: 'https://example.test/avatar',
    update: async payload => Object.assign(user, payload), toJSON: () => ({ id: user.id, isActive: user.isActive }),
    destroy: async options => {
      assert.equal(options.transaction, transaction);
      if (destroyFailure) throw new Error('Fixture database failure');
      deleted = true;
    },
  };
  const models = { User: {
    sequelize: { transaction: async callback => { const result = await callback(transaction); committed = true; return result; } },
    findOne: async options => {
      lookups.push(options);
      return missing || (options.where.organizationId && options.where.organizationId !== user.organizationId) ? null : user;
    },
  } };
  const mocks = { '../sequelize': { getModels: () => models },
    '../services/storage-service': { deleteRemoteFileByUrl: async url => { assert.equal(committed, true); cleaned.push(url); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, process, Date,
    require: name => mocks[name] || actual(name), console: { error() {}, warn() {} } }, { filename });
  const req = { params: { id: 'target' }, body: {}, auth: { roleCodes: ['superuser'], user: { organizationId: 'org' } } };
  const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  return { user, models, req, response, controller: module.exports, lookups, cleaned, deleted: () => deleted };
}

test('active accounts cannot be deleted, even when suspended or the request claims deactivation', async () => {
  for (const status of ['active', 'suspended', 'pending_verification', 'invited']) {
    const f = setup({ status }), res = f.response(); f.req.body.isActive = false;
    await f.controller.deleteUser(f.req, res);
    assert.equal(res.statusCode, 409); assert.match(res.body.message, /Deactivate/);
    assert.equal(f.deleted(), false); assert.equal(f.cleaned.length, 0);
    assert.equal(f.lookups[0].lock, 'UPDATE'); assert.ok(f.lookups[0].transaction);
  }
});

test('superuser must persist deactivation before account deletion succeeds', async () => {
  const f = setup(); f.req.body = { isActive: false };
  const update = f.response(); await f.controller.updateUser(f.req, update);
  assert.equal(update.statusCode, 200); assert.equal(f.user.isActive, false);
  const deletion = f.response(); await f.controller.deleteUser(f.req, deletion);
  assert.equal(deletion.statusCode, 200); assert.equal(f.deleted(), true);
  assert.deepEqual(f.cleaned, ['https://example.test/avatar']);
});

test('non-superusers cannot deactivate accounts and deletion keeps organization scope', async () => {
  const f = setup(); f.req.auth.roleCodes = ['administrator']; f.req.body = { isActive: false };
  const update = f.response(); await f.controller.updateUser(f.req, update);
  assert.equal(update.statusCode, 400); assert.equal(f.user.isActive, true);
  f.user.isActive = false; f.req.auth.user.organizationId = 'other';
  const deletion = f.response(); await f.controller.deleteUser(f.req, deletion);
  assert.equal(deletion.statusCode, 404); assert.equal(f.deleted(), false);
  assert.equal(f.lookups.at(-1).where.organizationId, 'other');
  delete f.req.auth.user.organizationId;
  const unscoped = f.response(); await f.controller.deleteUser(f.req, unscoped);
  assert.equal(unscoped.statusCode, 404); assert.equal(f.deleted(), false);
});

test('missing accounts and failed deletion do not remove profile files', async () => {
  for (const [options, code] of [[{ missing: true }, 404], [{ isActive: false, destroyFailure: true }, 500]]) {
    const f = setup(options), res = f.response(); await f.controller.deleteUser(f.req, res);
    assert.equal(res.statusCode, code); assert.equal(f.deleted(), false); assert.equal(f.cleaned.length, 0);
  }
});

test('an administrator can delete an already deactivated account in their organization', async () => {
  const f = setup({ isActive: false }), res = f.response(); f.req.auth.roleCodes = ['administrator'];
  await f.controller.deleteUser(f.req, res); assert.equal(res.statusCode, 200); assert.equal(f.deleted(), true);
});
