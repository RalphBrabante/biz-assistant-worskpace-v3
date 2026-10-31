const { test } = require('node:test');
const assert = require('node:assert/strict');
const { legacyRoleCodes } = require('../src/migrations/20261101000100-backfill-organization-roles');
const { membershipLabel, RESERVED_ROLE_CODES, isLockedPreset } = require('../src/services/organization-role-presets');
const {
  ensureOrganizationRoles, setMemberRoles, addMemberRole, removeMemberRole, assignPresetRole, resolveAssignableRole, memberRoleSummaries,
} = require('../src/services/organization-role-service');
const { effectiveRoleAccess, organizationAdminScope } = require('../src/services/role-access');
const { addOrganizationRoleFakes } = require('./helpers/organization-role-fakes');
const fs = require('node:fs');
const { refreshMemberSockets } = require('../src/services/organization-role-service');
const { setSocketServer } = require('../src/services/socket-service');

function setup() {
  const memberships = new Map();
  const member = (userId, organizationId = 'org', role = 'member', isActive = true) => {
    const row = { userId, organizationId, role, isActive, async update(payload) { Object.assign(this, payload); } };
    memberships.set(`${organizationId}:${userId}`, row);
    return row;
  };
  const models = {
    Role: { findOne: async () => null, findByPk: async (id) => (id === 'global-accountant' ? { code: 'accountant' } : id === 'global-superuser' ? { code: 'superuser' } : null) },
    Permission: { findAll: async () => [{ id: 'p-read' }] },
    User: {
      findByPk: async (id) => ({ id, organizationId: id === 'fallback' ? 'org' : 'other' }),
      findAll: async ({ where }) => [].concat(where.id).map((id) => ({ id })),
    },
    OrganizationUser: {
      findOne: async ({ where }) => memberships.get(`${where.organizationId}:${where.userId}`) || null,
      findAll: async ({ where }) => [...memberships.values()].filter((row) => row.organizationId === where.organizationId && [].concat(where.userId).includes(row.userId) && row.isActive === where.isActive),
      create: async (payload) => member(payload.userId, payload.organizationId, payload.role),
    },
  };
  const tables = addOrganizationRoleFakes(models);
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  return { models, tables, member, memberships, transaction };
}
const roleId = (code, organizationId = 'org') => `${organizationId}:${code}`;

test('every organization owns its own copy of the system roles, provisioned once', async () => {
  const f = setup();
  const [a, b] = [await ensureOrganizationRoles(f.models, 'a'), await ensureOrganizationRoles(f.models, 'b')];
  assert.deepEqual([...a.keys()], ['administrator', 'accountant', 'inventorymanager', 'enduser']);
  assert.notEqual(a.get('enduser').id, b.get('enduser').id);
  await ensureOrganizationRoles(f.models, 'a');
  assert.equal(f.tables.roles.length, 8);
});

test('a concurrent provisioning request is not an error', async () => {
  const f = setup();
  const [first, second] = await Promise.all([ensureOrganizationRoles(f.models, 'a'), ensureOrganizationRoles(f.models, 'a')]);
  assert.equal(first.get('administrator').id, second.get('administrator').id);
  assert.equal(f.tables.roles.length, 4);
});

test('assignments update the membership label to the highest system role and are audited', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org');
  const row = f.member('person');
  await setMemberRoles(f.models, { organizationId: 'org', userId: 'person', roleIds: [roleId('enduser'), roleId('inventorymanager')], actor: { userId: 'actor' }, transaction: f.transaction });
  assert.equal(row.role, 'inventorymanager');
  assert.deepEqual(f.tables.audit.map((entry) => entry.action), ['member.role_assigned', 'member.role_assigned']);
  assert.equal(f.tables.audit[0].actorUserId, 'actor');
  await setMemberRoles(f.models, { organizationId: 'org', userId: 'person', roleIds: [], actor: { userId: 'actor' }, transaction: f.transaction });
  assert.equal(row.role, 'member');
  assert.equal(f.tables.audit.at(-1).action, 'member.role_removed');
});

test('a role id from another organization is refused', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org'); await ensureOrganizationRoles(f.models, 'other');
  f.member('person');
  await assert.rejects(setMemberRoles(f.models, { organizationId: 'org', userId: 'person', roleIds: [roleId('enduser', 'other')], transaction: f.transaction }), (err) => err.status === 404);
  assert.equal(f.tables.assignments.length, 0);
});

test('only active members can hold roles; removed members are refused', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org');
  f.member('removed', 'org', 'enduser', false);
  await assert.rejects(setMemberRoles(f.models, { organizationId: 'org', userId: 'removed', roleIds: [roleId('enduser')], transaction: f.transaction }), (err) => err.status === 404);
  await assert.rejects(setMemberRoles(f.models, { organizationId: 'org', userId: 'stranger', roleIds: [roleId('enduser')], transaction: f.transaction }), (err) => err.status === 404);
});

test('an account tied only through users.organization_id becomes a real member when assigned', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org');
  await setMemberRoles(f.models, { organizationId: 'org', userId: 'fallback', roleIds: [roleId('enduser')], transaction: f.transaction });
  assert.ok(f.memberships.get('org:fallback'));
  assert.equal(f.tables.assignments.length, 1);
});

test('accountant cannot be combined with another role, in either order', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org'); f.member('person');
  await assert.rejects(setMemberRoles(f.models, { organizationId: 'org', userId: 'person', roleIds: [roleId('accountant'), roleId('enduser')], transaction: f.transaction }), (err) => err.status === 409);
  await addMemberRole(f.models, { organizationId: 'org', userId: 'person', roleId: roleId('accountant'), transaction: f.transaction });
  await assert.rejects(addMemberRole(f.models, { organizationId: 'org', userId: 'person', roleId: roleId('enduser'), transaction: f.transaction }), (err) => err.status === 409);
});

test('a disabled role cannot be newly assigned', async () => {
  const f = setup(); const catalogue = await ensureOrganizationRoles(f.models, 'org'); f.member('person');
  catalogue.get('inventorymanager').isActive = false;
  await assert.rejects(addMemberRole(f.models, { organizationId: 'org', userId: 'person', roleId: roleId('inventorymanager'), transaction: f.transaction }), (err) => err.status === 409);
  assert.equal(f.tables.assignments.length, 0);
});

test('administrators cannot remove themselves, and the last administrator always remains', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org');
  f.member('one'); f.member('two');
  const admin = roleId('administrator');
  await addMemberRole(f.models, { organizationId: 'org', userId: 'one', roleId: admin, transaction: f.transaction });
  await addMemberRole(f.models, { organizationId: 'org', userId: 'two', roleId: admin, transaction: f.transaction });
  await assert.rejects(removeMemberRole(f.models, { organizationId: 'org', userId: 'one', roleId: admin, actor: { userId: 'one' }, transaction: f.transaction }), /own administrator/);
  await removeMemberRole(f.models, { organizationId: 'org', userId: 'two', roleId: admin, actor: { userId: 'one' }, transaction: f.transaction });
  await assert.rejects(removeMemberRole(f.models, { organizationId: 'org', userId: 'one', roleId: admin, actor: { userId: 'platform', isSuperuser: true }, transaction: f.transaction }), /last administrator/);
  assert.equal(f.tables.assignments.length, 1);
});

test('account flows only assign system roles: labels and superuser never create an assignment', async () => {
  const f = setup(); f.member('person');
  assert.equal(await assignPresetRole(f.models, { organizationId: 'org', userId: 'person', code: 'member', transaction: f.transaction }), null);
  assert.equal(await assignPresetRole(f.models, { organizationId: 'org', userId: 'person', code: 'SUPERUSER', transaction: f.transaction }), null);
  assert.equal(f.tables.assignments.length, 0);
  assert.equal((await assignPresetRole(f.models, { organizationId: 'org', userId: 'person', code: 'EndUser', transaction: f.transaction })).presetCode, 'enduser');
});

test('a global template resolves to this organization’s copy, and superuser never resolves', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'other');
  assert.equal((await resolveAssignableRole(f.models, 'org', { roleId: 'global-accountant' })).id, roleId('accountant'));
  assert.equal(await resolveAssignableRole(f.models, 'org', { roleId: 'global-superuser' }), null);
  assert.equal(await resolveAssignableRole(f.models, 'org', { roleId: roleId('enduser', 'other') }), null);
  assert.equal(await resolveAssignableRole(f.models, 'org', { code: 'superuser' }), null);
});

test('member summaries are scoped to the requested organization', async () => {
  const f = setup(); await ensureOrganizationRoles(f.models, 'org'); await ensureOrganizationRoles(f.models, 'other');
  f.member('person'); f.member('person', 'other');
  await addMemberRole(f.models, { organizationId: 'org', userId: 'person', roleId: roleId('enduser'), transaction: f.transaction });
  await addMemberRole(f.models, { organizationId: 'other', userId: 'person', roleId: roleId('administrator', 'other'), transaction: f.transaction });
  assert.deepEqual((await memberRoleSummaries(f.models, 'org', ['person'])).get('person').map((role) => role.code), ['enduser']);
  assert.deepEqual((await memberRoleSummaries(f.models, 'other', ['person'])).get('person').map((role) => role.code), ['administrator']);
});

test('a global role row grants nothing outside the superuser role', async () => {
  const user = { id: 'person', organizationId: 'org' };
  const models = {
    Permission: {}, Role: {}, OrganizationRole: {},
    UserRole: { findAll: async () => [{ role: { code: 'administrator', permissions: [{ code: 'users.delete' }] } }] },
    OrganizationUserRole: { findAll: async () => [] },
    User: { findByPk: async () => ({ ...user, isActive: true, status: 'active' }) },
    OrganizationUser: { findOne: async () => ({ isActive: true }) },
  };
  const access = await effectiveRoleAccess(models, user, 'org');
  assert.deepEqual(access.roleCodes, []);
  assert.equal(access.permissions.size, 0);
  models.UserRole.findAll = async () => [{ role: { code: 'SUPERUSER', permissions: [{ code: 'users.delete' }] } }];
  assert.deepEqual((await effectiveRoleAccess(models, user, 'org')).roleCodes, ['superuser']);
});

test('custom roles can never hold platform permissions, even if a row was written by hand', async () => {
  const user = { id: 'person', organizationId: 'org' };
  const assigned = [{ role: { code: 'auditor', permissions: [{ code: 'expenses.read' }, { code: 'roles.manage' }, { code: 'banks.read' }, { code: '*' }] } }];
  const models = {
    Permission: {}, Role: {}, OrganizationRole: {},
    UserRole: { findAll: async () => [] },
    OrganizationUserRole: { findAll: async () => assigned },
    User: { findByPk: async () => ({ ...user, isActive: true, status: 'active' }) },
    OrganizationUser: { findOne: async () => ({ isActive: true }) },
  };
  assert.deepEqual([...(await effectiveRoleAccess(models, user, 'org')).permissions], ['expenses.read']);
});

test('role management scope: administrators stay in their organization, superusers must name one', () => {
  const request = (roleCodes, organizationId, query = {}) => ({ auth: { roleCodes, user: { organizationId } }, query });
  assert.equal(organizationAdminScope(request(['administrator'], 'org')), 'org');
  assert.throws(() => organizationAdminScope(request(['administrator'], 'org', { organizationId: 'other' })), (err) => err.status === 403);
  assert.throws(() => organizationAdminScope(request(['enduser'], 'org')), (err) => err.status === 403);
  assert.throws(() => organizationAdminScope(request(['superuser'], 'org')), (err) => err.status === 400);
  assert.equal(organizationAdminScope(request(['superuser'], 'org', { organizationId: 'other' })), 'other');
});

test('presets: labels, locks and reserved codes', () => {
  assert.equal(membershipLabel(['enduser', 'administrator']), 'administrator');
  assert.equal(membershipLabel([]), 'member');
  assert.ok(isLockedPreset('administrator') && isLockedPreset('accountant'));
  assert.ok(!isLockedPreset('enduser') && !isLockedPreset(null));
  for (const code of ['administrator', 'accountant', 'enduser', 'inventorymanager', 'superuser', 'member']) assert.ok(RESERVED_ROLE_CODES.includes(code));
});

test('the backfill reproduces the previous access rules', () => {
  const rules = (membership, globalCodes, isPrimaryOrganization = true) => legacyRoleCodes({
    membership, globalCodes, isSuperuser: globalCodes.includes('superuser'), isPrimaryOrganization,
  });
  const active = (role) => ({ is_active: true, role });
  assert.deepEqual(rules(active('accountant'), ['administrator']), ['accountant']);
  assert.deepEqual(rules(active('ENDUSER'), ['administrator']), ['enduser']);
  assert.deepEqual(rules(active('member'), ['inventorymanager']), ['inventorymanager']);
  assert.deepEqual(rules(active('member'), ['inventorymanager'], false), []);
  assert.deepEqual(rules(active('member'), ['accountant']), []);
  assert.deepEqual(rules(null, ['accountant', 'enduser']), ['accountant']);
  assert.deepEqual(rules({ is_active: false, role: 'enduser' }, []), []);
  assert.deepEqual(rules(active('enduser'), ['superuser', 'administrator']), ['administrator']);
  assert.deepEqual(rules(null, ['superuser']), []);
});

test('a role change moves the member’s live sockets, so a new accountant stops receiving organization messages', async () => {
  const f = setup();
  const joined = [], left = [];
  const socket = { data: { auth: { organizationId: 'org', roleCodes: ['enduser'] } }, join: (room) => joined.push(room), leave: (room) => left.push(room) };
  const elsewhere = { data: { auth: { organizationId: 'other', roleCodes: ['enduser'] } }, join: () => assert.fail('other organization'), leave: () => assert.fail('other organization') };
  f.models.User.findByPk = async () => ({ id: 'person', organizationId: 'org', isActive: true, status: 'active' });
  f.models.UserRole = { findAll: async () => [] };
  f.member('person');
  await ensureOrganizationRoles(f.models, 'org');
  await addMemberRole(f.models, { organizationId: 'org', userId: 'person', roleId: roleId('accountant'), transaction: f.transaction });
  f.models.OrganizationUserRole.findAll = async () => [{ role: { presetCode: 'accountant', code: 'accountant', permissions: [] } }];
  setSocketServer({ in: () => ({ fetchSockets: async () => [socket, elsewhere] }) });
  try {
    await refreshMemberSockets(f.models, 'org', 'person');
  } finally {
    setSocketServer(null);
  }
  assert.deepEqual(joined, ['accounting:org']);
  assert.deepEqual(left, ['org:org']);
  assert.deepEqual(socket.data.auth.roleCodes, ['accountant']);
});

test('no access decision reads global roles or the users.role label', () => {
  const tickets = fs.readFileSync(require.resolve('../src/controllers/tickets-controller'), 'utf8');
  assert.ok(!tickets.includes("association: 'roles'"), 'the Gmail callback must use the organization’s roles');
  assert.match(tickets, /effectiveRoleAccess\(models, user, state\.organizationId\)/);
  const users = fs.readFileSync(require.resolve('../src/controllers/users-controller'), 'utf8');
  assert.ok(!users.includes("role: String(user.role || 'member').toLowerCase()"), 'a label from one organization must not seed a membership in another');
});
