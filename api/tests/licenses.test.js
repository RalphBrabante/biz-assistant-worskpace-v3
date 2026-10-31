const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

let models;
const sequelizePath = require.resolve('../src/sequelize');
require.cache[sequelizePath] = { id: sequelizePath, filename: sequelizePath, loaded: true, exports: { getModels: () => models } };
const sent = [];
const emailPath = require.resolve('../src/services/email-service');
require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: { sendLicenseRevokedEmail: async (mail) => sent.push(mail), sendLicenseExpiryEmail: async (mail) => sent.push(mail) } };

const service = require('../src/services/license-service');
const controller = require('../src/controllers/licenses-controller');
const { sendExpiryNotices } = require('../src/jobs/license-expiry-job');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-01T00:00:00Z');

function row(fields) {
  return {
    ...fields,
    get() { return { ...this }; },
    toJSON() { return { ...this }; },
    async update(payload) { Object.assign(this, payload); return this; },
    async destroy() {},
  };
}

function fakeModels({ licenses = [], seats = {}, superusers = [], administrators = [] } = {}) {
  const calls = { findAndCountAll: [], queries: [] };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = {
    async query(sql, options) {
      calls.queries.push({ sql, replacements: options.replacements });
      if (sql.includes('seats.organization_id')) {
        return options.replacements.organizationIds.map((organizationId) => ({
          organizationId,
          used: (seats[organizationId] || []).filter((userId) => userId !== options.replacements.excludeUserId).length,
        }));
      }
      if (sql.includes("r.code = 'superuser' LIMIT 1")) {
        return superusers.includes(options.replacements.userId) ? [{ 1: 1 }] : [];
      }
      if (sql.includes("preset_code = 'administrator'")) return administrators;
      return [];
    },
    async transaction(fn) { return fn(transaction); },
  };
  const matches = (license, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) return true;
    return license[key] === value;
  });
  const License = {
    sequelize,
    async findOne({ where }) {
      if (where.id && where.id[Op.ne]) return null; // renewal / overlap lookups find nothing unless a test says so
      return licenses.find((license) => matches(license, where)) || null;
    },
    async findByPk(id) { return licenses.find((license) => license.id === id) || null; },
    async findAll() { return []; },
    async findAndCountAll(options) { calls.findAndCountAll.push(options); return { rows: [], count: 0 }; },
    async count() { return 0; },
    async create(payload) { const created = row({ id: 'new', ...payload }); licenses.push(created); return created; },
  };
  return {
    calls,
    License,
    Organization: {
      async findByPk(id) { return { id, name: 'Acme', contactEmail: 'owner@acme.test', isActive: true }; },
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const superuser = { auth: { roleCodes: ['superuser'], user: { organizationId: null } } };
const administrator = { auth: { roleCodes: ['administrator'], user: { organizationId: 'org-a' } } };

test('notice stages step 30 → 7 → 1 → expired and nothing earlier', () => {
  assert.equal(service.expiryNoticeStage(new Date(NOW.getTime() + 45 * DAY), NOW), null);
  assert.equal(service.expiryNoticeStage(new Date(NOW.getTime() + 30 * DAY), NOW), 30);
  assert.equal(service.expiryNoticeStage(new Date(NOW.getTime() + 8 * DAY), NOW), 30);
  assert.equal(service.expiryNoticeStage(new Date(NOW.getTime() + 5 * DAY), NOW), 7);
  assert.equal(service.expiryNoticeStage(new Date(NOW.getTime() + 2 * 60 * 60 * 1000), NOW), 1);
  assert.equal(service.expiryNoticeStage(new Date(NOW.getTime() - 1000), NOW), 0);
});

test('extensions add to the current term, or start from now once it has lapsed', () => {
  const active = { expiresAt: new Date('2026-12-15T00:00:00Z') };
  assert.equal(service.extendedExpiry(active, { years: 1 }, NOW).toISOString(), '2027-12-15T00:00:00.000Z');
  const lapsed = { expiresAt: new Date('2026-09-01T00:00:00Z') };
  assert.equal(service.extendedExpiry(lapsed, { months: 1 }, NOW).toISOString(), '2026-12-01T00:00:00.000Z');
  // Month ends clamp instead of rolling into the next month.
  assert.equal(service.addMonths(new Date('2027-01-31T00:00:00Z'), 1).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.throws(() => service.extendedExpiry(active, { months: 0 }, NOW), /1 to 120 months/);
  assert.throws(() => service.extendedExpiry(active, { expiresAt: '2026-12-01' }, NOW), /after the current expiry/);
  assert.throws(() => service.extendedExpiry(active, { expiresAt: 'soon' }, NOW), /valid new expiry/);
});

test('validation catches what the database would otherwise reject with a 500', () => {
  const valid = { planName: 'Silver', status: 'active', startsAt: '2026-01-01', expiresAt: '2027-01-01', maxUsers: 5 };
  assert.equal(service.licenseValidationError(valid), null);
  assert.match(service.licenseValidationError({ ...valid, status: 'Active!' }), /Status must be one of/);
  assert.match(service.licenseValidationError({ ...valid, planName: ' ' }), /Plan is required/);
  assert.match(service.licenseValidationError({ ...valid, expiresAt: '2025-01-01' }), /after the start date/);
  assert.match(service.licenseValidationError({ ...valid, maxUsers: 2.5 }), /whole number/);
  assert.equal(service.licenseValidationError({ ...valid, maxUsers: null }), null);
});

test('organization administrators cannot widen the list beyond their own organization', async () => {
  models = fakeModels();
  const res = response();
  await controller.listLicenses({ ...administrator, query: { unassigned: 'true', organizationId: 'org-b' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(models.calls.findAndCountAll[0].where.organizationId, 'org-a');

  models = fakeModels();
  await controller.listLicenses({ ...superuser, query: { unassigned: 'true' } }, response());
  assert.equal(models.calls.findAndCountAll[0].where.organizationId, null);
});

test('list rejects unknown statuses and filters "expiring" to active licenses ending within 30 days', async () => {
  models = fakeModels();
  const bad = response();
  await controller.listLicenses({ ...superuser, query: { status: 'nope' } }, bad);
  assert.equal(bad.statusCode, 400);

  await controller.listLicenses({ ...superuser, query: { status: 'expiring', q: 'Acme' } }, response());
  const { where, subQuery } = models.calls.findAndCountAll[0];
  assert.equal(where.status, 'active');
  assert.equal(where.revokedAt, null);
  assert.ok(Array.isArray(where.expiresAt[Op.between]));
  assert.ok(where[Op.or].some((clause) => '$organization.name$' in clause));
  assert.equal(subQuery, false);
});

test('reinstating a revoked license clears revokedAt so it grants access again', async () => {
  const license = row({ id: 'l1', organizationId: 'org-a', key: 'k', planName: 'Silver', status: 'revoked', isActive: false,
    revokedAt: new Date('2026-10-01'), startsAt: new Date('2026-01-01'), expiresAt: new Date('2027-01-01') });
  models = fakeModels({ licenses: [license] });
  const res = response();
  await controller.updateLicense({ ...superuser, params: { id: 'l1' }, body: { status: 'active', isActive: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(license.status, 'active');
  assert.equal(license.revokedAt, null);
  assert.equal(license.isActive, true);
});

test('updates with an invalid status are refused as 400 instead of failing in the database', async () => {
  const license = row({ id: 'l1', organizationId: 'org-a', planName: 'Silver', status: 'active', isActive: true,
    startsAt: new Date('2026-01-01'), expiresAt: new Date('2027-01-01') });
  models = fakeModels({ licenses: [license] });
  const res = response();
  await controller.updateLicense({ ...superuser, params: { id: 'l1' }, body: { status: 'paused' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(license.status, 'active');
});

test('moving an expired license to a future date reactivates it and restarts its notices', async () => {
  const license = row({ id: 'l1', organizationId: 'org-a', planName: 'Silver', status: 'expired', isActive: true, revokedAt: null,
    startsAt: new Date('2025-01-01'), expiresAt: new Date('2026-01-01'), expiryNoticeStage: 0 });
  models = fakeModels({ licenses: [license] });
  await controller.updateLicense({ ...superuser, params: { id: 'l1' }, body: { status: 'expired', expiresAt: '2099-01-01T00:00:00Z' } }, response());
  assert.equal(license.status, 'active');
  assert.equal(license.expiryNoticeStage, null);
});

test('extend renews expired licenses, keeps suspended ones suspended and refuses revoked ones', async () => {
  const expired = row({ id: 'e', status: 'expired', expiresAt: new Date('2026-01-01'), expiryNoticeStage: 0, isActive: true });
  const suspended = row({ id: 's', status: 'suspended', expiresAt: new Date('2099-01-01'), isActive: true });
  const revoked = row({ id: 'r', status: 'revoked', expiresAt: new Date('2099-01-01'), isActive: false });
  models = fakeModels({ licenses: [expired, suspended, revoked] });

  const ok = response();
  await controller.extendLicense({ ...superuser, params: { id: 'e' }, body: { years: 1 } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(expired.status, 'active');
  assert.equal(expired.expiryNoticeStage, null);
  assert.ok(expired.expiresAt.getTime() > Date.now());

  await controller.extendLicense({ ...superuser, params: { id: 's' }, body: { months: 1 } }, response());
  assert.equal(suspended.status, 'suspended');

  const refused = response();
  await controller.extendLicense({ ...superuser, params: { id: 'r' }, body: { months: 1 } }, refused);
  assert.equal(refused.statusCode, 409);

  const invalid = response();
  await controller.extendLicense({ ...superuser, params: { id: 's' }, body: { months: 500 } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('create defaults the start to now and stores a license dated in the past as expired', async () => {
  models = fakeModels();
  const res = response();
  await controller.createLicense({ ...superuser, body: { planName: 'Bronze', expiresAt: '2020-01-01T00:00:00Z', startsAt: '2019-01-01T00:00:00Z' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.status, 'expired');

  const missingPlan = response();
  await controller.createLicense({ ...superuser, body: { expiresAt: '2099-01-01T00:00:00Z' } }, missingPlan);
  assert.equal(missingPlan.statusCode, 400);
});

test('seat limits block new members once full, but never superusers, unlimited licenses or retries', async () => {
  const license = row({ id: 'l1', organizationId: 'org-a', status: 'active', isActive: true, revokedAt: null, maxUsers: 2, expiresAt: new Date('2099-01-01') });
  models = fakeModels({ licenses: [license], seats: { 'org-a': ['u1', 'u2'] }, superusers: ['staff'] });

  await assert.rejects(service.assertSeatAvailable(models, 'org-a', { userId: 'u3' }), (err) => err.status === 409 && /allows 2 active users/.test(err.message));
  // Someone who already holds a seat is not counted against themselves.
  await service.assertSeatAvailable(models, 'org-a', { userId: 'u2' });
  await service.assertSeatAvailable(models, 'org-a', { userId: 'staff' });

  license.maxUsers = 0;
  await service.assertSeatAvailable(models, 'org-a', { userId: 'u3' });
  license.maxUsers = null;
  await service.assertSeatAvailable(models, 'org-a', { userId: 'u3' });

  // No active license: sign-in is already blocked, so seats are not checked here.
  await service.assertSeatAvailable(fakeModels({ seats: { 'org-a': ['u1', 'u2'] } }), 'org-a', { userId: 'u3' });
});

function noticeModels(license, options = {}) {
  const base = fakeModels({ licenses: [license], administrators: options.administrators || [{ email: 'Admin@Acme.test', firstName: 'Ada' }] });
  base.License.findAll = async () => [{ id: license.id }];
  if (options.renewal) base.License.findOne = async () => ({ id: 'renewal' });
  return base;
}

test('expiry notices go out once per stage to administrators, with an in-app message', async () => {
  const license = row({ id: 'l1', organizationId: 'org-a', planName: 'Silver', status: 'active', isActive: true, revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 5 * DAY), expiryNoticeStage: null });
  const mails = [], messages = [];
  const deps = { models: noticeModels(license), send: async (mail) => mails.push(mail), notify: async (message) => messages.push(message) };

  assert.deepEqual(await sendExpiryNotices(NOW, deps), { sent: 1, failed: 0, skipped: false });
  assert.equal(license.expiryNoticeStage, 7);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].toEmail, 'admin@acme.test');
  assert.equal(mails[0].daysRemaining, 5);
  assert.equal(messages[0].entityType, 'license');
  assert.match(messages[0].title, /expires in 5 days/);

  // The same stage is never sent twice.
  assert.equal((await sendExpiryNotices(NOW, deps)).sent, 0);
  assert.equal(mails.length, 1);

  // Once it lapses, the expired notice follows.
  const later = new Date(license.expiresAt.getTime() + 60 * 1000);
  await sendExpiryNotices(later, deps);
  assert.equal(license.expiryNoticeStage, 0);
  assert.equal(mails[1].daysRemaining, 0);
});

test('a renewal already in place silences the warning, and a total send failure is retried', async () => {
  const renewed = row({ id: 'l1', organizationId: 'org-a', planName: 'Silver', status: 'active', isActive: true, revokedAt: null,
    expiresAt: new Date(NOW.getTime() + 5 * DAY), expiryNoticeStage: null });
  const mails = [];
  await sendExpiryNotices(NOW, { models: noticeModels(renewed, { renewal: true }), send: async (mail) => mails.push(mail), notify: async () => {} });
  assert.equal(mails.length, 0);
  assert.equal(renewed.expiryNoticeStage, 7);

  const failing = row({ ...renewed, id: 'l2', expiryNoticeStage: null });
  const result = await sendExpiryNotices(NOW, { models: noticeModels(failing), send: async () => { throw new Error('smtp down'); }, notify: async () => {} });
  assert.equal(result.failed, 1);
  assert.equal(failing.expiryNoticeStage, null);
});
