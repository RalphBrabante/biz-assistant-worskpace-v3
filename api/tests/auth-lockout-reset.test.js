const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');

const RAW_TOKEN = 'reset-token-a';

function setup() {
  let attempts = [
    { userId: 'user-a', lockedUntil: null },
    { userId: 'user-a', failureReason: 'account_lockout', lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
  ];
  const transactions = [];
  const tokenUpdates = [];
  const attemptDestroys = [];
  const user = {
    id: 'user-a', email: 'a@example.com', password: 'OldPass123', isActive: true, status: 'active', isEmailVerified: true, organizationId: null,
    update: async (payload) => {
      Object.assign(user, payload);
      // Mirrors the User model beforeUpdate hook
      if (payload.password) user.password = await bcrypt.hash(payload.password, 4);
    },
  };
  const tokenRecord = {
    userId: 'user-a', tokenHash: crypto.createHash('sha256').update(RAW_TOKEN).digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), user, update: async () => {},
  };
  const models = {
    User: {
      findOne: async () => user,
      sequelize: { transaction: async (callback) => { const transaction = { id: transactions.length + 1 }; transactions.push(transaction); return callback(transaction); } },
    },
    Token: {
      findOne: async ({ where }) => (where.tokenHash === tokenRecord.tokenHash ? tokenRecord : null),
      update: async (payload, options) => { tokenUpdates.push({ payload, options }); return [1]; },
      create: async (payload) => payload,
    },
    InvalidLoginAttempt: {
      findOne: async ({ where }) => attempts.find((row) => row.userId === where.userId && row.lockedUntil && row.lockedUntil > where.lockedUntil[Op.gt]) || null,
      destroy: async (options) => {
        attemptDestroys.push(options);
        const { where } = options;
        attempts = attempts.filter((row) => row.userId !== where.userId);
      },
    },
  };
  const dependencies = {
    '../sequelize': { getModels: () => models },
    '../services/role-access': { effectiveRoleAccess: async () => ({ roleCodes: ['superuser'], permissions: new Set() }), activeMember: async () => false },
    '../services/email-service': { sendPasswordResetEmail: async () => {}, sendEmailVerificationEmail: async () => {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/auth-controller.js'), 'utf8'), {
    module, exports: module.exports, console, process,
    require: (name) => (name in dependencies ? dependencies[name] : require(name)),
  });
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  return { controller: module.exports, response, transactions, tokenUpdates, attemptDestroys, getAttempts: () => attempts };
}

const loginRequest = (password) => ({ body: { email: 'a@example.com', password }, get: () => null });
const resetRequest = { body: { token: RAW_TOKEN, newPassword: 'NewPass123', confirmPassword: 'NewPass123' } };

test('locked account rejects login before password reset', async () => {
  const { controller, response } = setup();
  const res = response();
  await controller.login(loginRequest('OldPass123'), res);
  assert.equal(res.statusCode, 429);
});

test('password reset clears the lockout so the new password signs in immediately', async () => {
  const { controller, response, getAttempts } = setup();
  const resetRes = response();
  await controller.resetPassword(resetRequest, resetRes);
  assert.equal(resetRes.statusCode, 200);
  assert.equal(getAttempts().length, 0);

  const loginRes = response();
  await controller.login(loginRequest('NewPass123'), loginRes);
  assert.equal(loginRes.statusCode, 200);
  assert.equal(loginRes.body.ok, true);
});

test('password reset revokes sessions and clears the lockout in the same transaction', async () => {
  const { controller, response, transactions, tokenUpdates, attemptDestroys } = setup();
  await controller.resetPassword(resetRequest, response());
  assert.equal(transactions.length, 1);
  assert.equal(tokenUpdates.length, 1);
  assert.deepEqual([...tokenUpdates[0].options.where.type], ['reset_password', 'access', 'refresh']);
  assert.equal(tokenUpdates[0].options.transaction, transactions[0]);
  assert.equal(attemptDestroys.length, 1);
  assert.equal(attemptDestroys[0].transaction, transactions[0]);
});
