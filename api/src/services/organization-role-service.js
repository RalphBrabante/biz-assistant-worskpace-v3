const { Op } = require('sequelize');
const { fail } = require('./debt-amounts');
const { ACCOUNTANT_PERMISSIONS, isAccountant } = require('./accountant-access');
const { ROLE_PRESETS, PRESET_BY_CODE, membershipLabel } = require('./organization-role-presets');
const { effectiveRoleAccess } = require('./role-access');
const { getSocketServer } = require('./socket-service');

function recordRoleAudit(models, entry, transaction) {
  return models.OrganizationRoleAuditLog.create({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId || null,
    action: entry.action,
    roleId: entry.role?.id || null,
    roleName: entry.role?.name || null,
    targetUserId: entry.targetUserId || null,
    details: entry.details || null,
  }, { transaction });
}

async function templatePermissionIds(models, presetCode, transaction) {
  if (presetCode === 'accountant') {
    const rows = await models.Permission.findAll({
      where: { code: [...ACCOUNTANT_PERMISSIONS], isActive: true },
      attributes: ['id'],
      transaction,
    });
    return rows.map((row) => row.id);
  }
  const template = await models.Role.findOne({
    where: { code: presetCode },
    include: [{
      model: models.Permission,
      as: 'permissions',
      required: false,
      where: { isActive: true },
      through: { where: { isActive: true, isAllowed: true }, attributes: [] },
    }],
    transaction,
  });
  if (template) return (template.permissions || []).map((permission) => permission.id);
  if (presetCode !== 'administrator') return [];
  const all = await models.Permission.findAll({ where: { isActive: true }, attributes: ['id'], transaction });
  return all.map((row) => row.id);
}

// Idempotent. Gives an organization its own copy of every system role that it does not yet have.
async function ensureOrganizationRoles(models, organizationId, { transaction, actorUserId } = {}) {
  const existing = await models.OrganizationRole.findAll({
    where: { organizationId, presetCode: { [Op.ne]: null } },
    transaction,
  });
  const byCode = new Map(existing.map((role) => [role.presetCode, role]));
  for (const preset of ROLE_PRESETS) {
    if (byCode.has(preset.code)) continue;
    const provision = async (t) => {
      const template = await models.Role.findOne({ where: { code: preset.code }, attributes: ['description', 'isActive'], transaction: t });
      const role = await models.OrganizationRole.create({
        organizationId,
        presetCode: preset.code,
        code: preset.code,
        name: preset.name,
        description: template?.description || preset.description,
        isActive: template ? template.isActive : true,
        createdByUserId: actorUserId || null,
      }, { transaction: t });
      const permissionIds = await templatePermissionIds(models, preset.code, t);
      if (permissionIds.length) {
        await models.OrganizationRolePermission.bulkCreate(permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })), { transaction: t });
      }
      return role;
    };
    try {
      byCode.set(preset.code, transaction ? await provision(transaction) : await models.OrganizationRole.sequelize.transaction(provision));
    } catch (err) {
      // A concurrent request provisioned this role first, which is the result we wanted.
      if (err.name !== 'SequelizeUniqueConstraintError') throw err;
      byCode.set(preset.code, await models.OrganizationRole.findOne({ where: { organizationId, presetCode: preset.code }, transaction }));
    }
  }
  return byCode;
}

async function resolveMembership(models, organizationId, userId, transaction) {
  const membership = await models.OrganizationUser.findOne({ where: { organizationId, userId }, transaction });
  if (membership) return membership.isActive ? membership : null;
  // Accounts tied to an organization only through users.organization_id become real members,
  // because the database requires a membership behind every role assignment.
  const user = await models.User.findByPk(userId, { attributes: ['id', 'organizationId'], transaction });
  if (user?.organizationId !== organizationId) return null;
  return models.OrganizationUser.create({
    organizationId, userId, role: 'member', isActive: true, isPrimary: true,
  }, { transaction });
}

async function memberAssignments(models, organizationId, userId, transaction) {
  return models.OrganizationUserRole.findAll({
    where: { organizationId, userId },
    include: [{ model: models.OrganizationRole, as: 'role', required: true, where: { organizationId } }],
    transaction,
  });
}

async function syncMembershipLabel(models, organizationId, userId, transaction) {
  const membership = await models.OrganizationUser.findOne({ where: { organizationId, userId }, transaction });
  if (!membership) return;
  const assignments = await memberAssignments(models, organizationId, userId, transaction);
  const presetCodes = assignments.map((assignment) => assignment.role.presetCode).filter(Boolean);
  const current = String(membership.role || '').toLowerCase();
  // A platform superuser's own label is not an organization role and is left alone.
  if (!presetCodes.length && current === 'superuser') return;
  const label = membershipLabel(presetCodes);
  if (membership.role !== label) await membership.update({ role: label }, { transaction });
}

async function activeAdministratorIds(models, organizationId, transaction) {
  // Locking reads return the latest committed rows, even if this transaction's snapshot is older.
  const lock = transaction?.LOCK?.UPDATE;
  const role = await models.OrganizationRole.findOne({ where: { organizationId, presetCode: 'administrator' }, attributes: ['id'], transaction });
  if (!role) return [];
  const assignments = await models.OrganizationUserRole.findAll({ where: { organizationId, roleId: role.id }, attributes: ['userId'], transaction, lock });
  const assignedIds = assignments.map((assignment) => assignment.userId);
  if (!assignedIds.length) return [];
  const memberships = await models.OrganizationUser.findAll({
    where: { organizationId, userId: assignedIds, isActive: true },
    attributes: ['userId'],
    transaction,
    lock,
  });
  const users = await models.User.findAll({
    where: { id: memberships.map((membership) => membership.userId), isActive: true, status: 'active' },
    attributes: ['id'],
    transaction,
  });
  return users.map((user) => user.id);
}

// An organization that has administrators must keep at least one, or nobody inside it can manage access.
// Removals take the organization's row lock, so two administrators removing each other cannot both succeed.
async function assertAdministratorRemains(models, organizationId, userId, transaction) {
  if (models.Organization?.findByPk) {
    await models.Organization.findByPk(organizationId, { attributes: ['id'], transaction, lock: transaction?.LOCK?.UPDATE });
  }
  const administrators = await activeAdministratorIds(models, organizationId, transaction);
  if (administrators.length === 1 && administrators[0] === userId) {
    throw fail(409, 'This is the organization’s last administrator. Make someone else an administrator first.');
  }
}

// A rollback would have the previous model read user_roles again, so a revocation must not depend on
// this table alone. Global rows only ever applied in the member's primary organization.
async function retireGlobalGrant(models, organizationId, userId, role, transaction) {
  if (!models.UserRole?.destroy || (!role.presetCode && !role.legacyRoleId)) return;
  const user = await models.User.findByPk(userId, { attributes: ['organizationId'], transaction });
  if (user?.organizationId !== organizationId) return;
  const templateId = role.legacyRoleId
    || (await models.Role?.findOne?.({ where: { code: role.presetCode }, attributes: ['id'], transaction }))?.id;
  if (templateId) await models.UserRole.destroy({ where: { userId, roleId: templateId }, transaction });
}

// The single path for changing what a member holds. Callers must hold a transaction.
async function setMemberRoles(models, { organizationId, userId: requestedUserId, roleIds, actor, transaction }) {
  const membership = await resolveMembership(models, organizationId, requestedUserId, transaction);
  if (!membership) throw fail(404, 'Active organization member not found.');
  // The stored id, not the requested one: MySQL matches ids that differ only by trailing spaces,
  // which would otherwise slip past the guards below.
  const userId = membership.userId;

  const wanted = [...new Set(roleIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const roles = wanted.length
    ? await models.OrganizationRole.findAll({ where: { id: wanted, organizationId }, transaction })
    : [];
  if (roles.length !== wanted.length) throw fail(404, 'Organization role not found.');
  if (roles.length > 1 && roles.some((role) => role.presetCode === 'accountant')) {
    throw fail(409, 'The Accountant role has fixed read-only access and cannot be combined with other roles.');
  }

  const current = await memberAssignments(models, organizationId, userId, transaction);
  const currentIds = new Set(current.map((assignment) => assignment.roleId));
  const removed = current.filter((assignment) => !wanted.includes(assignment.roleId));
  const added = roles.filter((role) => !currentIds.has(role.id));
  if (added.some((role) => !role.isActive)) throw fail(409, 'Activate the role before assigning it.');

  if (removed.some((assignment) => assignment.role.presetCode === 'administrator')) {
    if (actor?.userId === userId && !actor.isSuperuser) {
      throw fail(409, 'You cannot remove your own administrator role. Ask another administrator to do this.');
    }
    await assertAdministratorRemains(models, organizationId, userId, transaction);
  }

  for (const assignment of removed) {
    await assignment.destroy({ transaction });
    await retireGlobalGrant(models, organizationId, userId, assignment.role, transaction);
    await recordRoleAudit(models, {
      organizationId, actorUserId: actor?.userId, action: 'member.role_removed', role: assignment.role, targetUserId: userId,
    }, transaction);
  }
  for (const role of added) {
    await models.OrganizationUserRole.create({
      organizationId, roleId: role.id, userId, assignedByUserId: actor?.userId || null,
    }, { transaction });
    await recordRoleAudit(models, {
      organizationId, actorUserId: actor?.userId, action: 'member.role_assigned', role, targetUserId: userId,
    }, transaction);
  }
  await syncMembershipLabel(models, organizationId, userId, transaction);
  return { added, removed: removed.map((assignment) => assignment.role) };
}

async function addMemberRole(models, { organizationId, userId, roleId, actor, transaction }) {
  const current = await memberAssignments(models, organizationId, userId, transaction);
  const roleIds = current.map((assignment) => assignment.roleId);
  if (roleIds.includes(roleId)) return { added: [], removed: [] };
  return setMemberRoles(models, { organizationId, userId, roleIds: [...roleIds, roleId], actor, transaction });
}

async function removeMemberRole(models, { organizationId, userId, roleId, actor, transaction }) {
  const current = await memberAssignments(models, organizationId, userId, transaction);
  const roleIds = current.map((assignment) => assignment.roleId);
  return setMemberRoles(models, { organizationId, userId, roleIds: roleIds.filter((id) => id !== roleId), actor, transaction });
}

// Used by the account flows (invite, create, assign existing). A code that is not a system role
// changes nothing, so a label such as 'member' or 'superuser' can never create an assignment.
async function assignPresetRole(models, { organizationId, userId, code, actor, transaction }) {
  const presetCode = String(code || '').toLowerCase();
  if (!PRESET_BY_CODE.has(presetCode)) return null;
  const catalogue = await ensureOrganizationRoles(models, organizationId, { transaction, actorUserId: actor?.userId });
  const role = catalogue.get(presetCode);
  await addMemberRole(models, { organizationId, userId, roleId: role.id, actor, transaction });
  return role;
}

// Finds the role to assign from a request. roleId may name this organization's own role, or a
// global template (whose organization copy is then used). Global templates never grant directly.
async function resolveAssignableRole(models, organizationId, { roleId, code }, transaction) {
  const catalogue = await ensureOrganizationRoles(models, organizationId, { transaction });
  if (roleId) {
    const own = await models.OrganizationRole.findOne({ where: { id: roleId, organizationId }, transaction });
    if (own) return own;
    const template = await models.Role.findByPk(roleId, { attributes: ['code'], transaction });
    return template ? catalogue.get(String(template.code).toLowerCase()) || null : null;
  }
  return catalogue.get(String(code || '').toLowerCase()) || null;
}

// Live sockets joined their room when they connected, so a role change has to move them as well.
// Without this, a member switched to Accountant keeps receiving every organization message.
async function refreshMemberSockets(models, organizationId, userId) {
  const io = getSocketServer();
  if (!io) return;
  try {
    const user = await models.User.findByPk(userId);
    if (!user) return;
    const { roleCodes } = await effectiveRoleAccess(models, user, organizationId);
    const accountant = isAccountant(roleCodes);
    const sockets = await io.in(`user:${user.id}`).fetchSockets();
    for (const socket of sockets) {
      if (socket.data?.auth?.organizationId !== organizationId) continue;
      socket.data.auth.roleCodes = roleCodes;
      socket.leave(`${accountant ? 'org' : 'accounting'}:${organizationId}`);
      socket.join(`${accountant ? 'accounting' : 'org'}:${organizationId}`);
    }
  } catch (err) {
    console.error('Refresh member sockets error:', { name: err.name });
  }
}

// { userId: [{ id, name, code, presetCode }] } for display on member lists.
async function memberRoleSummaries(models, organizationId, userIds) {
  const summaries = new Map();
  if (!models.OrganizationUserRole || !models.OrganizationRole || !organizationId || !userIds.length) return summaries;
  const assignments = await models.OrganizationUserRole.findAll({
    where: { organizationId, userId: userIds },
    include: [{ model: models.OrganizationRole, as: 'role', required: true, where: { organizationId } }],
  });
  for (const assignment of assignments) {
    if (!summaries.has(assignment.userId)) summaries.set(assignment.userId, []);
    const { id, name, code, presetCode } = assignment.role;
    summaries.get(assignment.userId).push({ id, name, code, presetCode: presetCode || null });
  }
  return summaries;
}

module.exports = {
  recordRoleAudit,
  templatePermissionIds,
  ensureOrganizationRoles,
  syncMembershipLabel,
  assertAdministratorRemains,
  activeAdministratorIds,
  setMemberRoles,
  addMemberRole,
  removeMemberRole,
  assignPresetRole,
  resolveAssignableRole,
  memberRoleSummaries,
  memberAssignments,
  refreshMemberSockets,
};
