const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function setup({ existing = false, failAt, emailFailure = false } = {}) {
  const filename = require.resolve('../src/controllers/users-controller');
  const actual = createRequire(filename), transaction = {}, writes = [], emails = [], logs = [];
  let committed = false;
  const failure = { name: 'SequelizeDatabaseError', original: { code: 'ER_TEST_FAILURE' }, sql: 'private SQL', parameters: ['secret-password'] };
  const check = (options, step) => {
    assert.equal(options.transaction, transaction, step);
    if (failAt === step) throw failure;
  };
  const models = {
    Organization: { findByPk: async id => id === 'org' ? { id, name: 'Test', getUsers: async () => [] } : null },
    Role: { findAll: async () => [{ id: 'role', code: 'enduser' }] },
    User: {
      sequelize: { transaction: async callback => {
        const before = writes.length;
        try { const result = await callback(transaction); committed = true; return result; }
        catch (error) { writes.splice(before); throw error; }
      } },
      findOne: async options => { assert.equal(options.where.email, 'new@example.test'); return existing ? { id: 'existing' } : null; },
      findAll: async () => [],
      create: async (payload, options) => {
        check(options, 'user');
        const user = { id: 'new', ...payload, toJSON: () => ({ id: 'new', ...payload }) };
        writes.push({ step: 'user', payload }); return user;
      },
      update: async (_payload, options) => check(options, 'primary-user'),
    },
    OrganizationUser: {
      findOrCreate: async options => { check(options, 'membership'); writes.push({ step: 'membership', payload: options.defaults }); return [{}, true]; },
      update: async (_payload, options) => check(options, 'primary-membership'),
    },
    UserRole: { bulkCreate: async (payload, options) => { check(options, 'roles'); assert.equal(options.ignoreDuplicates, undefined); writes.push({ step: 'roles', payload }); } },
    Token: { update: async () => {}, create: async () => {} },
  };
  const mocks = {
    '../sequelize': { getModels: () => models },
    '../services/email-service': { sendOrganizationUserInviteEmail: async payload => {
      assert.equal(committed, true); emails.push(payload); if (emailFailure) throw new Error('Test mail outage');
    } },
    '../services/message-service': { getActorDisplayName: () => 'Test actor', createOrganizationMessage: async () => { assert.equal(committed, true); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, process, Date,
    require: name => mocks[name] || actual(name), console: { error: (...args) => logs.push(args), warn() {} } }, { filename });
  const req = { body: { organizationId: 'org', firstName: ' New ', lastName: ' User ', email: ' NEW@example.test ', password: 'secret-password', roleIds: ['role'] },
    auth: { userId: 'actor', roleCodes: ['administrator'], user: { id: 'actor', organizationId: 'org' } }, get: () => '', ip: '127.0.0.1' };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { models, req, res, writes, emails, logs, failure, run: () => module.exports.createUser(req, res) };
}

test('duplicate email returns a useful conflict with no writes or invitation', async () => {
  const f = setup({ existing: true }); await f.run();
  assert.equal(f.res.statusCode, 409); assert.match(f.res.body.message, /email already exists/);
  assert.equal(f.writes.length, 0); assert.equal(f.emails.length, 0);
});

test('account, primary membership and roles commit together before notifications; password is not returned', async () => {
  const f = setup(); f.req.body.organizationId = 'another-org'; await f.run();
  assert.equal(f.res.statusCode, 201); assert.equal(f.writes.length, 3);
  assert.equal(f.writes[0].payload.organizationId, 'org'); assert.equal(f.writes[0].payload.firstName, 'New');
  assert.equal(f.writes[1].payload.isPrimary, true); assert.equal(f.writes[2].payload[0].assignedByUserId, 'actor');
  assert.equal(f.res.body.data.password, undefined); assert.equal(f.emails.length, 1);
});

for (const failAt of ['membership', 'primary-membership', 'primary-user', 'roles']) {
  test(`${failAt} failure rolls back the new account and access so a retry remains possible`, async () => {
    const f = setup({ failAt }); await f.run();
    assert.equal(f.res.statusCode, 500); assert.equal(f.writes.length, 0); assert.equal(f.emails.length, 0);
    assert.ok(!JSON.stringify(f.logs).includes('secret-password')); assert.ok(!JSON.stringify(f.logs).includes('private SQL'));
  });
}

test('concurrent duplicate email is handled by the database constraint after the precheck', async () => {
  for (const field of ['email', 'users_email', 'users.users_email']) {
    const f = setup(); f.models.User.create = async () => { throw { name: 'SequelizeUniqueConstraintError', fields: { [field]: 'private@example.test' } }; };
    await f.run(); assert.equal(f.res.statusCode, 409); assert.match(f.res.body.message, /email already exists/); assert.equal(f.emails.length, 0);
  }
});

test('invalid email/model validation returns a safe 400 instead of an internal error', async () => {
  const f = setup(); f.models.User.create = async () => { throw { name: 'SequelizeValidationError', errors: [{ value: 'secret-password' }] }; };
  await f.run(); assert.equal(f.res.statusCode, 400); assert.match(f.res.body.message, /Invalid user details/);
  assert.ok(!JSON.stringify(f.res.body).includes('secret-password'));
});

test('database field lengths and text types are validated before any write', async () => {
  for (const [field, limit] of Object.entries({ firstName: 100, lastName: 100, email: 255, phone: 30, addressLine1: 255, addressLine2: 255, city: 100, state: 100, postalCode: 20, country: 100 })) {
    const f = setup(); f.req.body[field] = 'x'.repeat(limit + 1); await f.run();
    assert.equal(f.res.statusCode, 400, field); assert.equal(f.writes.length, 0, field); assert.match(f.res.body.message, new RegExp(field));
  }
  const f = setup(); f.req.body.firstName = {}; await f.run(); assert.equal(f.res.statusCode, 400);
});

test('an invitation delivery failure reports a created account and keeps the committed access', async () => {
  const f = setup({ emailFailure: true }); await f.run();
  assert.equal(f.res.statusCode, 201); assert.equal(f.writes.length, 3); assert.equal(f.res.body.data.inviteEmail.sent, false);
});
