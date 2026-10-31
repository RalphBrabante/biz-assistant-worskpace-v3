// Proves per-organization roles against real MySQL or MariaDB: the backfill, tenant isolation and the role API.
// Accepts only an empty, disposable role_test_* database on a role-test-* host.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Sequelize, QueryTypes } = require('sequelize');

const database = process.env.ROLE_TEST_DATABASE;
const host = process.env.ROLE_TEST_HOST;
const password = process.env.ROLE_TEST_PASSWORD;
if (!/^role_test_[a-z0-9_]+$/.test(database || '') || !/^role-test-[a-z0-9-]+$/.test(host || '') || !password) {
  throw new Error('Set ROLE_TEST_DATABASE=role_test_*, ROLE_TEST_HOST=role-test-* and ROLE_TEST_PASSWORD.');
}

const root = path.resolve(__dirname, '..');
const env = { ...process.env, DB_HOST: host, DB_NAME: database, DB_USER: 'root', DB_PASSWORD: password };
const cli = (...args) => execFileSync(path.join(root, 'node_modules/.bin/sequelize-cli'), args, { cwd: root, env, stdio: 'pipe' });

const { initModels } = require('../src/models');
const { effectiveRoleAccess } = require('../src/services/role-access');
const {
  ensureOrganizationRoles, memberRoleSummaries,
} = require('../src/services/organization-role-service');
const { legacyRoleCodes } = require('../src/migrations/20261101000100-backfill-organization-roles');

const LAST_LEGACY_MIGRATION = '20261006000000-add-chat-replies.js';
const s = new Sequelize(database, 'root', password, { host, dialect: 'mysql', logging: false, pool: { max: 8 } });
const rows = (sql, replacements) => s.query(sql, { type: QueryTypes.SELECT, replacements });
const run = (sql, replacements) => s.query(sql, { replacements });
const ORGS = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const USERS = Object.fromEntries(['admin', 'second', 'capped', 'memberPrimary', 'fallback', 'fallbackAccountant', 'fallbackCustom', 'customGlobal', 'collision', 'removed', 'platform', 'stranger', 'target', 'labelCase', 'unchanged', 'labelled']
  .map((name) => [name, randomUUID()]));
const passed = [];
const check = (name) => passed.push(name);

async function seedOrganization(id, name) {
  const [{ taxTypeId } = {}] = await rows('SELECT id AS taxTypeId FROM tax_types LIMIT 1').catch(() => [{}]);
  const columns = await rows("SELECT COLUMN_NAME name, IS_NULLABLE nullable, COLUMN_DEFAULT dflt, DATA_TYPE type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations'");
  const values = { id, name, is_active: 1, created_at: new Date(), updated_at: new Date(), tax_type_id: taxTypeId || null };
  for (const column of columns) {
    if (column.name in values || column.nullable === 'YES' || column.dflt !== null) continue;
    values[column.name] = ['varchar', 'text', 'char'].includes(column.type) ? 'Test' : 0;
  }
  await s.getQueryInterface().bulkInsert('organizations', [values]);
}

async function seedFixture() {
  for (const [key, id] of Object.entries(ORGS)) await seedOrganization(id, `Company ${key.toUpperCase()}`);
  const qi = s.getQueryInterface(), now = new Date();
  const primary = {
    admin: ORGS.a, second: ORGS.a, capped: ORGS.b, memberPrimary: ORGS.a, fallback: ORGS.a, fallbackAccountant: ORGS.a,
    customGlobal: ORGS.a, collision: ORGS.a, removed: ORGS.a, platform: ORGS.a, stranger: ORGS.c, target: ORGS.a,
    fallbackCustom: ORGS.a, labelCase: ORGS.a, unchanged: ORGS.a, labelled: ORGS.a,
  };
  await qi.bulkInsert('users', Object.entries(USERS).map(([name, id]) => ({
    id, organization_id: primary[name], first_name: name, last_name: 'Test', email: `${name}@example.test`, password: 'hash',
    role: 'member', status: 'active', is_active: true, is_email_verified: true, created_at: now, updated_at: now,
  })));
  const membership = (user, org, role, extra = {}) => ({
    id: randomUUID(), user_id: USERS[user], organization_id: ORGS[org], role, is_active: true, is_primary: primary[user] === ORGS[org], created_at: now, updated_at: now, ...extra,
  });
  await qi.bulkInsert('organization_users', [
    membership('admin', 'a', 'administrator'), membership('admin', 'b', 'enduser'),
    membership('second', 'a', 'administrator'),
    membership('capped', 'b', 'accountant'),
    membership('memberPrimary', 'a', 'member'), membership('memberPrimary', 'b', 'member'),
    membership('customGlobal', 'a', 'member'),
    membership('collision', 'a', 'member'),
    membership('removed', 'a', 'enduser', { is_active: false, is_primary: false }),
    membership('platform', 'a', 'SUPERUSER'),
    membership('stranger', 'c', 'administrator'),
    membership('target', 'a', 'enduser'),
    membership('labelCase', 'a', 'Administrator'),
    membership('unchanged', 'a', 'member'),
    membership('labelled', 'a', 'enduser'),
  ]);
  const roleId = async (code) => (await rows('SELECT id FROM roles WHERE code = ?', [code]))[0].id;
  const custom = randomUUID();
  await qi.bulkInsert('roles', [{ id: custom, name: 'AUDITOR', code: 'auditor', description: 'Custom global role', is_system: false, is_active: true, created_at: now, updated_at: now }]);
  const permissionIds = await rows("SELECT id FROM permissions WHERE code IN ('expenses.read', 'banks.read')");
  await qi.bulkInsert('role_permissions', permissionIds.map((permission) => ({
    id: randomUUID(), role_id: custom, permission_id: permission.id, is_allowed: true, is_active: true, assigned_at: now, created_at: now, updated_at: now,
  })));
  const globalRole = async (user, code) => ({ id: randomUUID(), user_id: USERS[user], role_id: await roleId(code), is_active: true, assigned_at: now, created_at: now, updated_at: now });
  await qi.bulkInsert('user_roles', [
    await globalRole('capped', 'administrator'),
    await globalRole('memberPrimary', 'inventorymanager'),
    await globalRole('fallback', 'enduser'),
    await globalRole('unchanged', 'enduser'),
    await globalRole('fallbackAccountant', 'accountant'),
    { id: randomUUID(), user_id: USERS.customGlobal, role_id: custom, is_active: true, assigned_at: now, created_at: now, updated_at: now },
    await globalRole('platform', 'superuser'),
    await globalRole('platform', 'administrator'),
    // A global administrator elsewhere: this must never become an administrator of Company C.
    await globalRole('admin', 'administrator'),
  ]);
  // An existing custom role that collides with the name and code of a system role, and an orphan row.
  const clash = randomUUID();
  await qi.bulkInsert('organization_roles', [{ id: clash, organization_id: ORGS.a, name: 'End User', code: 'enduser', description: 'Custom', is_active: true, created_at: now, updated_at: now }]);
  await qi.bulkInsert('organization_user_roles', [
    { id: randomUUID(), organization_id: ORGS.a, role_id: clash, user_id: USERS.collision, created_at: now, updated_at: now },
    { id: randomUUID(), organization_id: ORGS.a, role_id: clash, user_id: USERS.stranger, created_at: now, updated_at: now },
    { id: randomUUID(), organization_id: ORGS.a, role_id: clash, user_id: USERS.fallbackCustom, created_at: now, updated_at: now },
  ]);
  await run('UPDATE users SET role = ? WHERE id = ?', ['administrator', USERS.labelled]);
  return { clash };
}

function loadController(models, file = 'organization-roles-controller') {
  const filename = path.resolve(__dirname, `../src/controllers/${file}.js`);
  const real = createRequire(filename), module = { exports: {} };
  // No real email from a test, whatever the environment holds.
  const mailbox = { sendOrganizationUserInviteEmail: async () => {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console: { error() {}, warn() {} }, Date, Math, process, Buffer,
    require: (name) => (name === '../sequelize' ? { getModels: () => models } : name === '../services/email-service' ? mailbox : real(name)),
  }, { filename });
  return module.exports;
}

(async () => {
  try {
    await s.authenticate();
    if ((await s.getQueryInterface().showAllTables()).length) throw new Error('Refusing nonempty database.');

    // --- The previous schema, with data shaped like years of real use.
    cli('db:migrate', '--to', LAST_LEGACY_MIGRATION);
    cli('db:seed', '--seed', '20260215016000-seed-rbac-and-default-user.js');
    const fixture = await seedFixture();
    const permissionsOf = async (code) => (await rows(`SELECT p.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
      WHERE r.code = ? AND rp.is_active = 1 AND rp.is_allowed = 1 AND p.is_active = 1`, [code])).map((row) => row.code).sort();
    const endUserDefaults = await permissionsOf('enduser');
    const inventoryDefaults = await permissionsOf('inventorymanager');
    assert.ok(endUserDefaults.length && inventoryDefaults.length);

    // --- Migrate, and resume as an interrupted deploy would.
    cli('db:migrate');
    const qi = s.getQueryInterface();
    const countAll = async () => (await rows('SELECT (SELECT COUNT(*) FROM organization_roles) r, (SELECT COUNT(*) FROM organization_user_roles) a, (SELECT COUNT(*) FROM organization_role_permissions) p, (SELECT COUNT(*) FROM organization_users) m'))[0];
    const afterFirst = await countAll();
    await require('../src/migrations/20261101000100-backfill-organization-roles').up(qi);
    await require('../src/migrations/20261101000200-enforce-organization-role-tenancy').up(qi);
    assert.deepEqual(await countAll(), afterFirst);
    check('backfill is idempotent after an interrupted deploy');

    const models = initModels(s);
    const userById = async (id) => models.User.findByPk(id);
    const access = async (name, org) => effectiveRoleAccess(models, await userById(USERS[name]), ORGS[org]);
    const perms = (result) => [...result.permissions].sort();

    // --- Every organization owns a full catalogue.
    for (const org of Object.values(ORGS)) {
      const presets = (await rows('SELECT preset_code p FROM organization_roles WHERE organization_id = ? AND preset_code IS NOT NULL', [org])).map((row) => row.p).sort();
      assert.deepEqual(presets, ['accountant', 'administrator', 'enduser', 'inventorymanager']);
    }
    check('every organization received its own four system roles');

    // --- Nobody's access changed, and global roles stopped leaking between organizations.
    assert.deepEqual((await access('admin', 'a')).roleCodes, ['administrator']);
    assert.deepEqual((await access('admin', 'b')).roleCodes, ['enduser']);
    assert.deepEqual(perms(await access('admin', 'b')), endUserDefaults);
    assert.equal((await access('admin', 'c')).permissions.size, 0);
    check('a multi-organization member holds a different role in each organization');

    const { ACCOUNTANT_PERMISSIONS } = require('../src/services/accountant-access');
    assert.deepEqual((await access('capped', 'b')).roleCodes, ['accountant']);
    assert.deepEqual(perms(await access('capped', 'b')), [...ACCOUNTANT_PERMISSIONS].sort());
    check('an accountant stays capped despite a global administrator row');

    assert.deepEqual((await access('memberPrimary', 'a')).roleCodes, ['inventorymanager']);
    assert.deepEqual(perms(await access('memberPrimary', 'a')), inventoryDefaults);
    assert.equal((await access('memberPrimary', 'b')).permissions.size, 0);
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ? AND organization_id = ?', [USERS.memberPrimary, ORGS.a]))[0].role, 'inventorymanager');
    check('a global role applies only in the primary organization it came from');

    assert.deepEqual((await access('fallback', 'a')).roleCodes, ['enduser']);
    const fallbackRow = (await rows('SELECT role, is_active, is_primary FROM organization_users WHERE user_id = ?', [USERS.fallback]))[0];
    assert.deepEqual([fallbackRow.role, fallbackRow.is_active, fallbackRow.is_primary], ['enduser', 1, 1]);
    assert.deepEqual((await access('fallbackAccountant', 'a')).roleCodes, ['accountant']);
    assert.deepEqual((await access('fallbackCustom', 'a')).roleCodes, ['org:custom_enduser']);
    assert.equal((await rows('SELECT COUNT(*) n FROM organization_users WHERE user_id = ?', [USERS.fallbackCustom]))[0].n, 1);
    check('accounts tied to an organization only through users.organization_id became real members, keeping custom roles');

    const customAccess = await access('customGlobal', 'a');
    assert.deepEqual(perms(customAccess), ['banks.read', 'expenses.read']);
    const copied = (await rows("SELECT code, legacy_role_id FROM organization_roles WHERE organization_id = ? AND code = 'auditor'", [ORGS.a]))[0];
    assert.ok(copied.legacy_role_id);
    assert.equal((await rows("SELECT COUNT(*) n FROM organization_roles WHERE organization_id = ? AND code = 'auditor'", [ORGS.b]))[0].n, 0);
    check('a custom global role was copied only where it was used and keeps its grants');

    const renamed = (await rows('SELECT code, name FROM organization_roles WHERE id = ?', [fixture.clash]))[0];
    assert.deepEqual([renamed.code, renamed.name], ['custom_enduser', 'End User (custom)']);
    assert.deepEqual((await access('collision', 'a')).roleCodes, ['org:custom_enduser']);
    check('a custom role colliding with a system role was renamed, not lost');

    assert.equal((await access('removed', 'a')).permissions.size, 0);
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ?', [USERS.removed]))[0].role, 'enduser');
    assert.equal((await rows('SELECT COUNT(*) n FROM organization_user_roles WHERE user_id = ?', [USERS.removed]))[0].n, 0);
    check('a removed member gains nothing and keeps their label for reinstatement');

    const platform = await access('platform', 'b');
    assert.ok(platform.roleCodes.includes('superuser'));
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ?', [USERS.platform]))[0].role, 'SUPERUSER');
    check('superusers keep platform access and their label');

    assert.equal((await rows('SELECT COUNT(*) n FROM organization_user_roles WHERE user_id = ? AND organization_id = ?', [USERS.stranger, ORGS.a]))[0].n, 0);
    check('assignments without a membership were removed');

    // --- The database refuses a cross-tenant assignment, whatever the application does.
    const roleB = (await rows("SELECT id FROM organization_roles WHERE organization_id = ? AND preset_code = 'enduser'", [ORGS.b]))[0].id;
    const insertAssignment = (org, role, user) => run('INSERT INTO organization_user_roles (id, organization_id, role_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())', [randomUUID(), org, role, user]);
    await assert.rejects(insertAssignment(ORGS.a, roleB, USERS.target), /foreign key/i);
    await assert.rejects(insertAssignment(ORGS.b, roleB, USERS.target), /foreign key/i);
    check('the database rejects a role or member from another organization');

    // --- The role API.
    const controller = loadController(models);
    const call = async (method, { actor = 'admin', org = 'a', roleCodes = ['administrator'], params = {}, body = {}, query = {} } = {}) => {
      const res = { statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(payload) { this.body = payload; return this; } };
      await controller[method]({
        params, body, query,
        auth: { userId: USERS[actor], roleCodes, user: { id: USERS[actor], organizationId: org ? ORGS[org] : null } },
      }, res);
      return res;
    };
    const roleIn = async (org, code) => (await rows('SELECT id FROM organization_roles WHERE organization_id = ? AND code = ?', [ORGS[org], code]))[0]?.id;
    const permissionId = async (code) => (await rows('SELECT id FROM permissions WHERE code = ?', [code]))[0].id;

    assert.equal((await call('list', { roleCodes: ['enduser'] })).statusCode, 403);
    assert.equal((await call('list', { actor: 'stranger', org: 'c', query: { organizationId: ORGS.a } })).statusCode, 403);
    assert.equal((await call('list', { actor: 'platform', roleCodes: ['superuser'], org: null })).statusCode, 400);
    const asPlatform = await call('list', { actor: 'platform', roleCodes: ['superuser'], query: { organizationId: ORGS.c } });
    assert.equal(asPlatform.statusCode, 200);
    assert.ok(asPlatform.body.data.every((role) => role.presetCode));
    check('only an organization’s administrators manage its roles; superusers must name the organization');

    // Editing one organization's copy leaves every other organization alone.
    const endUserA = await roleIn('a', 'enduser');
    const expensesRead = await permissionId('expenses.read');
    assert.equal((await call('grant', { params: { id: endUserA }, body: { permissionId: expensesRead } })).statusCode, 200);
    assert.ok(perms(await access('target', 'a')).includes('expenses.read'));
    assert.deepEqual(perms(await access('admin', 'b')), endUserDefaults);
    assert.deepEqual(await permissionsOf('enduser'), endUserDefaults);
    check('changing a role in one organization affects no other organization or template, immediately');

    assert.equal((await call('reset', { params: { id: endUserA } })).statusCode, 200);
    assert.deepEqual(perms(await access('target', 'a')), endUserDefaults);
    check('a system role can be reset to its defaults');

    const restricted = await permissionId('banks.read');
    assert.equal((await call('grant', { params: { id: endUserA }, body: { permissionId: restricted } })).statusCode, 403);
    assert.equal((await call('create', { body: { name: 'Sneaky', code: 'sneaky', permissionIds: [restricted] } })).statusCode, 403);
    check('platform-only permissions cannot be granted through organization roles');

    for (const code of ['administrator', 'accountant']) {
      assert.equal((await call('grant', { params: { id: await roleIn('a', code) }, body: { permissionId: expensesRead } })).statusCode, 409);
    }
    for (const code of ['administrator', 'enduser', 'superuser', 'member', 'superadmin']) {
      assert.equal((await call('create', { body: { name: `Fake ${code}`, code } })).statusCode, 400, code);
    }
    assert.equal((await call('remove', { params: { id: endUserA } })).statusCode, 409);
    assert.equal((await call('update', { params: { id: endUserA }, body: { name: 'Staff', isActive: false } })).statusCode, 409);
    assert.equal((await call('update', { params: { id: endUserA }, body: { name: 'Staff', code: 'staff' } })).statusCode, 409);
    assert.equal((await call('update', { params: { id: endUserA }, body: { name: 'Staff' } })).statusCode, 200);
    assert.deepEqual((await access('target', 'a')).roleCodes, ['enduser']);
    check('system roles keep their identity: locked permissions, reserved codes, no delete or disable');

    // Custom roles.
    const created = await call('create', { body: { name: 'Cashier', code: 'cashier', description: 'Front desk', permissionIds: [expensesRead] } });
    assert.equal(created.statusCode, 201);
    const cashier = created.body.data.id;
    assert.equal((await call('create', { body: { name: 'Cashier', code: 'cashier_two' } })).statusCode, 409);
    assert.equal((await call('create', { actor: 'stranger', org: 'c', body: { name: 'Cashier', code: 'cashier' } })).statusCode, 201);
    check('role names and codes are unique per organization, not globally');

    assert.equal((await call('assign', { params: { id: cashier }, body: { userId: USERS.target } })).statusCode, 200);
    assert.deepEqual((await access('target', 'a')).roleCodes.sort(), ['enduser', 'org:cashier']);
    assert.ok(perms(await access('target', 'a')).includes('expenses.read'));
    assert.equal((await call('assign', { params: { id: cashier }, body: { userId: USERS.stranger } })).statusCode, 404);
    assert.equal((await call('assign', { actor: 'stranger', org: 'c', params: { id: cashier }, body: { userId: USERS.stranger } })).statusCode, 404);
    check('custom roles grant immediately and cannot cross organizations');

    assert.equal((await call('remove', { params: { id: cashier } })).statusCode, 409);
    assert.equal((await call('update', { params: { id: cashier }, body: { name: 'Cashier', isActive: false } })).statusCode, 200);
    assert.deepEqual((await access('target', 'a')).roleCodes, ['enduser']);
    assert.equal((await call('update', { params: { id: cashier }, body: { name: 'Cashier', isActive: true } })).statusCode, 200);
    const clone = await call('clone', { params: { id: await roleIn('a', 'administrator') }, body: { name: 'Almost admin', code: 'almost_admin' } });
    assert.equal(clone.statusCode, 201);
    const cloned = await models.OrganizationRole.findByPk(clone.body.data.id, { include: [{ model: models.Permission, as: 'permissions' }] });
    assert.ok(cloned.permissions.length > 0);
    assert.ok(cloned.permissions.every((permission) => !['roles', 'permissions', 'organizations', 'licenses', 'settings', 'banks'].includes(permission.code.split('.')[0])));
    check('disabling removes access at once; copying an administrator role drops platform-only permissions');

    // Accountant cannot be combined.
    const accountantA = await roleIn('a', 'accountant');
    assert.equal((await call('setRolesForMember', { params: { userId: USERS.target }, body: { roleIds: [accountantA, cashier] } })).statusCode, 409);
    assert.equal((await call('setRolesForMember', { params: { userId: USERS.target }, body: { roleIds: [accountantA] } })).statusCode, 200);
    assert.deepEqual((await access('target', 'a')).roleCodes, ['accountant']);
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ? AND organization_id = ?', [USERS.target, ORGS.a]))[0].role, 'accountant');
    assert.equal((await call('assign', { params: { id: cashier }, body: { userId: USERS.target } })).statusCode, 409);
    check('the accountant role is exclusive and the membership label follows the assignments');

    // Lockout protection, including two administrators demoting each other at the same moment.
    const adminA = await roleIn('a', 'administrator');
    assert.deepEqual((await access('labelCase', 'a')).roleCodes, ['administrator']);
    assert.equal((await call('unassign', { params: { id: adminA, userId: USERS.labelCase } })).statusCode, 200);
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ?', [USERS.labelCase]))[0].role, 'member');
    assert.equal((await call('unassign', { params: { id: adminA, userId: USERS.admin } })).statusCode, 409);
    // The superuser became an administrator through the backfill; leave exactly two for the race.
    assert.equal((await call('unassign', { params: { id: adminA, userId: USERS.platform } })).statusCode, 200);
    const raced = await Promise.all([
      call('unassign', { actor: 'admin', params: { id: adminA, userId: USERS.second } }),
      call('unassign', { actor: 'second', params: { id: adminA, userId: USERS.admin } }),
    ]);
    const admins = await rows('SELECT user_id FROM organization_user_roles WHERE role_id = ?', [adminA]);
    assert.equal(admins.length, 1, 'exactly one administrator must survive');
    assert.deepEqual(raced.map((res) => res.statusCode).sort(), [200, 409]);
    assert.equal((await call('setRolesForMember', {
      actor: 'platform', roleCodes: ['superuser'], query: { organizationId: ORGS.a },
      params: { userId: admins[0].user_id }, body: { roleIds: [] },
    })).statusCode, 409);
    // MySQL matches ids that differ only by trailing spaces; that must not slip past the guards.
    const survivorName = admins[0].user_id === USERS.admin ? 'admin' : 'second';
    const paddedId = `${admins[0].user_id} `;
    assert.equal((await call('setRolesForMember', { actor: survivorName, params: { userId: paddedId }, body: { roleIds: [] } })).statusCode, 404);
    assert.equal((await call('unassign', { actor: survivorName, params: { id: adminA, userId: paddedId } })).statusCode, 404);
    const { setMemberRoles } = require('../src/services/organization-role-service');
    await assert.rejects(s.transaction((transaction) => setMemberRoles(models, {
      organizationId: ORGS.a, userId: paddedId, roleIds: [], actor: { userId: admins[0].user_id }, transaction,
    })), /own administrator/);
    await assert.rejects(s.transaction((transaction) => setMemberRoles(models, {
      organizationId: ORGS.a, userId: paddedId, roleIds: [], actor: { userId: USERS.platform, isSuperuser: true }, transaction,
    })), /last administrator/);
    assert.equal((await rows('SELECT COUNT(*) n FROM organization_user_roles WHERE role_id = ?', [adminA]))[0].n, 1);

    // The same race through member removal, several times: one lucky ordering proves nothing.
    const organizationsController = loadController(models, 'organizations-controller');
    for (let round = 0; round < 3; round += 1) {
      const raceOrg = randomUUID();
      await seedOrganization(raceOrg, `Race ${round}`);
      const catalogue = await ensureOrganizationRoles(models, raceOrg);
      const pair = [randomUUID(), randomUUID()];
      const now = new Date();
      await qi.bulkInsert('users', pair.map((id, index) => ({
        id, organization_id: raceOrg, first_name: `Race${index}`, last_name: 'Test', email: `race${round}-${index}@example.test`, password: 'hash',
        role: 'member', status: 'active', is_active: true, is_email_verified: true, created_at: now, updated_at: now,
      })));
      await qi.bulkInsert('organization_users', pair.map((id) => ({
        id: randomUUID(), organization_id: raceOrg, user_id: id, role: 'administrator', is_active: true, is_primary: true, created_at: now, updated_at: now,
      })));
      await qi.bulkInsert('organization_user_roles', pair.map((id) => ({
        id: randomUUID(), organization_id: raceOrg, role_id: catalogue.get('administrator').id, user_id: id, created_at: now, updated_at: now,
      })));
      const remove = async (actor, target) => {
        const res = { statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
        await organizationsController.removeUserFromOrganization({
          params: { id: raceOrg, userId: target }, auth: { userId: actor, roleCodes: ['administrator'], user: { id: actor, organizationId: raceOrg } },
        }, res);
        return res.statusCode;
      };
      const statuses = await Promise.all([remove(pair[0], pair[1]), remove(pair[1], pair[0])]);
      assert.deepEqual(statuses.sort(), [200, 409], `round ${round}`);
      const left = await rows('SELECT COUNT(*) n FROM organization_users ou JOIN organization_user_roles a ON a.organization_id = ou.organization_id AND a.user_id = ou.user_id WHERE ou.organization_id = ? AND ou.is_active = 1', [raceOrg]);
      assert.equal(left[0].n, 1, `round ${round}`);
    }
    check('no one can remove themselves or the last administrator, even in a race or with a padded id');

    // Only administrators hand out powerful roles; a label from one organization never grants in another.
    const usersController = loadController(models, 'users-controller');
    const usersCall = async (method, { actor = 'target', org = 'a', roleCodes = ['enduser'], params = {}, body = {}, query = {} }) => {
      const res = { statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(payload) { this.body = payload; return this; } };
      await usersController[method]({
        params, body, query, ip: '127.0.0.1', get: () => '',
        auth: { userId: USERS[actor], roleCodes, user: { id: USERS[actor], organizationId: ORGS[org] }, isPrivileged: roleCodes.some((code) => ['administrator', 'superuser'].includes(code)) },
      }, res);
      return res;
    };
    const newAccount = (roleIds) => ({ firstName: 'New', lastName: 'Person', email: `new-${randomUUID()}@example.test`, password: 'test-only', roleIds });
    assert.equal((await usersCall('createUser', { body: newAccount([adminA]) })).statusCode, 403);
    assert.equal((await usersCall('createUser', { body: newAccount([cashier]) })).statusCode, 403);
    assert.equal((await rows("SELECT COUNT(*) n FROM users WHERE first_name = 'New' AND last_name = 'Person'"))[0].n, 0);
    assert.equal((await usersCall('addRoleToUser', { actor: 'target', params: { id: USERS.target }, body: { roleId: (await rows("SELECT id FROM roles WHERE code = 'inventorymanager'"))[0].id } })).statusCode, 403);
    check('someone with users.create or users.update cannot grant an administrator or custom role, or promote themselves');

    const platformCall = (method, options) => usersCall(method, { actor: 'platform', roleCodes: ['superuser'], ...options });
    assert.equal((await platformCall('addOrganizationToUser', { params: { id: USERS.labelled }, body: { organizationId: ORGS.b } })).statusCode, 201);
    assert.equal((await access('labelled', 'b')).permissions.size, 0);
    assert.deepEqual((await access('labelled', 'b')).roleCodes, []);
    const endUserB = await roleIn('b', 'enduser');
    assert.equal((await platformCall('addOrganizationToUser', { params: { id: USERS.labelled }, body: { organizationId: ORGS.b, roleId: endUserB } })).statusCode, 200);
    assert.deepEqual((await access('labelled', 'b')).roleCodes, ['enduser']);
    check('users.role from one organization never becomes access in another; roles there are chosen explicitly');

    // People in other organizations stay private.
    const searching = (query, actor = 'second', roleCodes = ['administrator']) => {
      const res = { statusCode: 200, set() {}, status(n) { this.statusCode = n; return this; }, json(payload) { this.body = payload; return this; } };
      return organizationsController.searchAssignableUsers({
        params: { id: ORGS.a }, query, auth: { userId: USERS[actor], roleCodes, user: { id: USERS[actor], organizationId: ORGS.a } },
      }, res).then(() => res.body);
    };
    assert.equal((await searching({ limit: '100' })).data.length, 0);
    assert.equal((await searching({ q: 'capped' })).data.length, 0);
    const exact = (await searching({ q: 'CAPPED@example.test' })).data;
    assert.equal(exact.length, 1);
    assert.deepEqual(Object.keys(exact[0]).sort(), ['email', 'firstName', 'id', 'lastName']);
    assert.ok((await searching({ limit: '100' }, 'platform', ['superuser'])).data.length > 1);
    const adminDetail = (await usersCall('getUserById', { actor: 'second', roleCodes: ['administrator'], params: { id: USERS.admin } })).body.data;
    assert.deepEqual([...adminDetail.organizations].map((organization) => organization.id), [ORGS.a]);
    assert.equal(adminDetail.roles.length, 0);
    check('administrators cannot browse other tenants’ users or see a member’s other organizations');

    // A revocation has to survive a rollback.
    assert.equal((await call('setRolesForMember', { actor: survivorName, params: { userId: USERS.memberPrimary }, body: { roleIds: [] } })).statusCode, 200);
    assert.equal((await rows("SELECT COUNT(*) n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.code = 'inventorymanager'", [USERS.memberPrimary]))[0].n, 0);
    check('revoking a role also retires the global row behind it');

    // A cashier's role deletion after removing its members, and the audit trail.
    assert.equal((await call('remove', { params: { id: cashier }, actor: admins[0].user_id === USERS.admin ? 'admin' : 'second' })).statusCode, 200);
    const audit = await call('auditLog', { actor: admins[0].user_id === USERS.admin ? 'admin' : 'second', query: { limit: 100 } });
    const actions = new Set(audit.body.data.map((entry) => entry.action));
    for (const action of ['role.created', 'role.updated', 'role.deleted', 'role.cloned', 'role.permissions_changed', 'role.reset_to_defaults', 'member.role_assigned', 'member.role_removed', 'migration.catalogue_provisioned']) {
      assert.ok(actions.has(action), action);
    }
    assert.ok(audit.body.data.some((entry) => entry.actor && entry.targetUser && entry.action === 'member.role_assigned'));
    assert.equal(audit.body.data.some((entry) => entry.roleName === 'Almost admin' && entry.action === 'role.created'), false);
    const audited = (await call('auditLog', { actor: 'stranger', org: 'c', query: { limit: 100 } })).body.data;
    assert.ok(audited.every((entry) => !['role.cloned'].includes(entry.action)));
    check('every change is audited, per organization');

    // New organizations and list display.
    const fresh = randomUUID();
    await seedOrganization(fresh, 'Company New');
    const catalogue = await ensureOrganizationRoles(models, fresh);
    assert.equal(catalogue.size, 4);
    assert.deepEqual([...(await ensureOrganizationRoles(models, fresh)).keys()].sort(), [...catalogue.keys()].sort());
    await Promise.all([ensureOrganizationRoles(models, randomUUID()).catch(() => null)]);
    const summaries = await memberRoleSummaries(models, ORGS.a, [USERS.customGlobal]);
    assert.equal(summaries.get(USERS.customGlobal)[0].code, 'auditor');
    check('new organizations are provisioned idempotently');

    // The migration's reproduction of the previous rules, checked directly.
    assert.deepEqual(legacyRoleCodes({ membership: { is_active: true, role: 'enduser' }, globalCodes: ['administrator'], isSuperuser: false, isPrimaryOrganization: true }), ['enduser']);
    assert.deepEqual(legacyRoleCodes({ membership: null, globalCodes: ['accountant', 'enduser'], isSuperuser: false, isPrimaryOrganization: true }), ['accountant']);
    assert.deepEqual(legacyRoleCodes({ membership: { is_active: true, role: 'member' }, globalCodes: ['enduser'], isSuperuser: false, isPrimaryOrganization: false }), []);

    // Deleting an organization or a member cascades cleanly across all the foreign keys.
    await run('DELETE FROM users WHERE id = ?', [USERS.fallback]);
    assert.equal((await rows('SELECT COUNT(*) n FROM organization_user_roles WHERE user_id = ?', [USERS.fallback]))[0].n, 0);
    await run('DELETE FROM organizations WHERE id = ?', [ORGS.c]);
    assert.equal((await rows('SELECT COUNT(*) n FROM organization_roles WHERE organization_id = ?', [ORGS.c]))[0].n, 0);
    assert.equal((await rows('SELECT COUNT(*) n FROM organization_role_audit_logs WHERE organization_id = ?', [ORGS.c]))[0].n, 0);
    check('deleting a user or organization cascades through the new tables');

    // Roll back to the previous schema.
    const labelsBefore = await rows('SELECT user_id, organization_id FROM organization_users WHERE user_id = ?', [USERS.memberPrimary]);
    cli('db:migrate:undo'); cli('db:migrate:undo'); cli('db:migrate:undo');
    assert.equal((await rows("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_role_audit_logs'"))[0].n, 0);
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ? AND organization_id = ?', [USERS.unchanged, ORGS.a]))[0].role, 'member');
    // A demotion made after the upgrade must not be undone by restoring the old label.
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ?', [USERS.labelCase]))[0].role, 'member');
    // The previous resolver ignores a global accountant once a membership exists, so the label stays.
    assert.equal((await rows('SELECT role FROM organization_users WHERE user_id = ?', [USERS.fallbackAccountant]))[0].role, 'accountant');
    assert.deepEqual([(await rows('SELECT code FROM organization_roles WHERE id = ?', [fixture.clash]))[0].code], ['enduser']);
    assert.equal(labelsBefore.length, 2);
    check('all three migrations roll back and restore the previous labels and names');

    for (const name of passed) console.log(`ok - ${name}`);
    console.log(`PASS organization roles: ${passed.length} scenarios against a real database.`);
  } finally {
    await s.close();
  }
})().catch((err) => {
  for (const name of passed) console.log(`ok - ${name}`);
  console.error('FAILED after the scenarios above:', err);
  process.exit(1);
});
