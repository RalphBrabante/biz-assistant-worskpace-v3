const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { fail } = require('../services/debt-amounts');
const { organizationPermissionAllowed, organizationAdminScope, activeMember } = require('../services/role-access');
const { PRESET_BY_CODE, RESERVED_ROLE_CODES, isLockedPreset } = require('../services/organization-role-presets');
const {
  recordRoleAudit,
  templatePermissionIds,
  ensureOrganizationRoles,
  setMemberRoles,
  addMemberRole,
  removeMemberRole,
  memberAssignments,
  syncMembershipLabel,
  refreshMemberSockets,
} = require('../services/organization-role-service');

function endpoint(fn) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const organizationId = organizationAdminScope(req);
      const models = getModels();
      const isSuperuser = (req.auth?.roleCodes || []).includes('superuser');
      if (isSuperuser) {
        if (!await models.Organization.findByPk(organizationId, { attributes: ['id'] })) throw fail(404, 'Organization not found.');
      } else if (!await activeMember(models, req.auth.userId, organizationId)) {
        throw fail(403, 'Only this organization’s administrator can manage its roles.');
      }
      await fn(req, res, models, { organizationId, actor: { userId: req.auth.userId, isSuperuser } });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A role with that name or code already exists in this organization.' });
      }
      console.error('Organization role error:', { name: err.name, message: err.message });
      return res.status(500).json({ message: 'Unable to complete this role action.' });
    }
  };
}

// Every change takes the organization's row lock, so concurrent administrators cannot race
// past the last-administrator check or the uniqueness rules.
function write(models, organizationId, fn) {
  return models.OrganizationRole.sequelize.transaction(async (transaction) => {
    await models.Organization.findByPk(organizationId, { transaction, lock: transaction.LOCK.UPDATE, attributes: ['id'] });
    await ensureOrganizationRoles(models, organizationId, { transaction });
    return fn(transaction);
  });
}

async function findRole(models, id, organizationId, transaction) {
  const role = await models.OrganizationRole.findOne({ where: { id, organizationId }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!role) throw fail(404, 'Organization role not found.');
  return role;
}

function memberIdParam(req) {
  const userId = String(req.params.userId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw fail(404, 'Active organization member not found.');
  return userId;
}

function assertCustomCode(code) {
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(code) || RESERVED_ROLE_CODES.includes(code)) {
    throw fail(400, 'Enter a role code using lowercase letters, numbers and underscores. System role codes are reserved.');
  }
}

function roleValues(body, existing) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  if (!name || name.length > 100) throw fail(400, 'Enter a role name of up to 100 characters.');
  if (description.length > 2000) throw fail(400, 'Keep the description under 2000 characters.');
  if (body.isSystem || body.presetCode) throw fail(403, 'Custom roles cannot be made into system roles.');
  if (existing?.presetCode) {
    // System role codes are stable identifiers, and these roles always stay available.
    if (body.code !== undefined && String(body.code).trim().toLowerCase() !== existing.code) throw fail(409, 'A system role’s code cannot be changed.');
    if (body.isActive === false) throw fail(409, 'System roles cannot be disabled.');
    return { name, description };
  }
  const code = String(body.code ?? existing?.code ?? '').trim().toLowerCase();
  assertCustomCode(code);
  const isActive = body.isActive === undefined ? (existing ? existing.isActive : true) : body.isActive;
  if (typeof isActive !== 'boolean') throw fail(400, 'Choose whether the role is active.');
  return { name, code, description, isActive };
}

function serializeRole(role) {
  const preset = PRESET_BY_CODE.get(role.presetCode);
  const members = role.members || [];
  return {
    id: role.id,
    name: role.name,
    code: role.code,
    description: role.description,
    isActive: role.isActive,
    isSystem: Boolean(role.presetCode),
    presetCode: role.presetCode || null,
    permissionsLocked: isLockedPreset(role.presetCode),
    canReset: Boolean(preset && !preset.locked),
    permissions: (role.permissions || []).map(({ id, code, name, resource, action }) => ({ id, code, name, resource, action })),
    members: members.map(({ id, firstName, lastName, email }) => ({ id, firstName, lastName, email })),
    memberCount: members.length,
    updatedAt: role.updatedAt,
  };
}

function bySystemRankThenName(a, b) {
  const rank = (role) => PRESET_BY_CODE.get(role.presetCode)?.rank || 0;
  return rank(b) - rank(a) || a.name.localeCompare(b.name);
}

const list = endpoint(async (req, res, m, { organizationId, actor }) => {
  await ensureOrganizationRoles(m, organizationId, { actorUserId: actor.userId });
  const rows = await m.OrganizationRole.findAll({
    where: { organizationId },
    include: [
      { model: m.Permission, as: 'permissions', through: { attributes: [] } },
      { model: m.User, as: 'members', attributes: ['id', 'firstName', 'lastName', 'email'], through: { attributes: [] } },
    ],
  });
  const data = [...rows].sort(bySystemRankThenName).map(serializeRole);
  res.json({ data, meta: { total: data.length } });
});

const options = endpoint(async (req, res, m, { organizationId, actor }) => {
  await ensureOrganizationRoles(m, organizationId, { actorUserId: actor.userId });
  const permissions = (await m.Permission.findAll({ where: { isActive: true }, order: [['resource', 'ASC'], ['action', 'ASC']] }))
    .filter(organizationPermissionAllowed)
    .map(({ id, code, name, resource, action, description }) => ({ id, code, name, resource, action, description }));
  const memberships = await m.OrganizationUser.findAll({ where: { organizationId }, attributes: ['userId', 'isActive'] });
  const active = memberships.filter((row) => row.isActive).map((row) => row.userId);
  const inactive = memberships.filter((row) => !row.isActive).map((row) => row.userId);
  const members = await m.User.findAll({
    where: { isActive: true, status: { [Op.in]: ['active', 'invited'] }, [Op.or]: [{ id: { [Op.in]: active } }, { organizationId, id: { [Op.notIn]: inactive } }] },
    attributes: ['id', 'firstName', 'lastName', 'email'],
    order: [['firstName', 'ASC'], ['lastName', 'ASC']],
  });
  const assignments = await m.OrganizationUserRole.findAll({ where: { organizationId }, attributes: ['userId', 'roleId'] });
  res.json({
    data: {
      permissions,
      members: members.map(({ id, firstName, lastName, email }) => ({
        id, firstName, lastName, email,
        roleIds: assignments.filter((row) => row.userId === id).map((row) => row.roleId),
      })),
    },
  });
});

async function validatedPermissions(m, permissionIds, transaction, alreadyHeld = new Set()) {
  if (!Array.isArray(permissionIds)) throw fail(400, 'permissionIds must be a list.');
  const ids = [...new Set(permissionIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const rows = ids.length ? await m.Permission.findAll({ where: { id: ids, isActive: true }, transaction }) : [];
  if (rows.length !== ids.length) throw fail(404, 'Permission not found.');
  // Anything this role already held may stay; new grants must be ones organizations may hold.
  if (rows.some((row) => !alreadyHeld.has(row.id) && !organizationPermissionAllowed(row))) {
    throw fail(403, 'This permission is restricted to platform administrators.');
  }
  return rows;
}

async function applyPermissions(m, role, permissions, actor, transaction, action = 'role.permissions_changed') {
  const current = await role.getPermissions({ transaction, joinTableAttributes: [] });
  const wanted = new Set(permissions.map((permission) => permission.id));
  const held = new Set(current.map((permission) => permission.id));
  const removed = current.filter((permission) => !wanted.has(permission.id));
  const added = permissions.filter((permission) => !held.has(permission.id));
  if (removed.length) {
    await m.OrganizationRolePermission.destroy({ where: { roleId: role.id, permissionId: removed.map((permission) => permission.id) }, transaction });
  }
  if (added.length) {
    await m.OrganizationRolePermission.bulkCreate(added.map((permission) => ({ roleId: role.id, permissionId: permission.id })), { transaction });
  }
  if (added.length || removed.length) {
    await role.update({ updatedByUserId: actor.userId }, { transaction });
    await recordRoleAudit(m, {
      organizationId: role.organizationId, actorUserId: actor.userId, action, role,
      details: { added: added.map((permission) => permission.code), removed: removed.map((permission) => permission.code) },
    }, transaction);
  }
}

function assertPermissionsEditable(role) {
  if (isLockedPreset(role.presetCode)) {
    throw fail(409, role.presetCode === 'administrator'
      ? 'Administrators always have full access to their organization.'
      : 'The Accountant role has fixed read-only access.');
  }
}

const create = endpoint(async (req, res, m, { organizationId, actor }) => {
  const body = req.body || {};
  const payload = roleValues(body);
  const role = await write(m, organizationId, async (transaction) => {
    const permissions = await validatedPermissions(m, body.permissionIds || [], transaction);
    const created = await m.OrganizationRole.create({ ...payload, organizationId, createdByUserId: actor.userId }, { transaction });
    if (permissions.length) {
      await m.OrganizationRolePermission.bulkCreate(permissions.map((permission) => ({ roleId: created.id, permissionId: permission.id })), { transaction });
    }
    await recordRoleAudit(m, {
      organizationId, actorUserId: actor.userId, action: 'role.created', role: created,
      details: { code: created.code, permissions: permissions.map((permission) => permission.code) },
    }, transaction);
    return created;
  });
  res.status(201).json({ data: role, message: 'Organization role created.' });
});

const update = endpoint(async (req, res, m, { organizationId, actor }) => {
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    const payload = roleValues(req.body || {}, role);
    const changes = Object.fromEntries(Object.entries(payload)
      .filter(([key, value]) => (role[key] ?? '') !== value)
      .map(([key, value]) => [key, { from: role[key] ?? null, to: value }]));
    await role.update({ ...payload, updatedByUserId: actor.userId }, { transaction });
    if (Object.keys(changes).length) {
      await recordRoleAudit(m, { organizationId, actorUserId: actor.userId, action: 'role.updated', role, details: { changes } }, transaction);
    }
  });
  res.json({ message: 'Organization role updated.' });
});

const remove = endpoint(async (req, res, m, { organizationId, actor }) => {
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    if (role.presetCode) throw fail(409, 'System roles cannot be deleted.');
    const memberCount = await m.OrganizationUserRole.count({ where: { organizationId, roleId: role.id }, transaction });
    if (memberCount) throw fail(409, `${memberCount} member${memberCount === 1 ? ' still holds' : 's still hold'} this role. Remove them from it first.`);
    await recordRoleAudit(m, {
      organizationId, actorUserId: actor.userId, action: 'role.deleted', role, details: { code: role.code },
    }, transaction);
    await role.destroy({ transaction });
  });
  res.json({ message: 'Organization role deleted.' });
});

const clone = endpoint(async (req, res, m, { organizationId, actor }) => {
  const payload = roleValues(req.body || {});
  const role = await write(m, organizationId, async (transaction) => {
    const source = await findRole(m, req.params.id, organizationId, transaction);
    const permissions = (await source.getPermissions({ transaction, joinTableAttributes: [] })).filter(organizationPermissionAllowed);
    const created = await m.OrganizationRole.create({ ...payload, organizationId, createdByUserId: actor.userId }, { transaction });
    if (permissions.length) {
      await m.OrganizationRolePermission.bulkCreate(permissions.map((permission) => ({ roleId: created.id, permissionId: permission.id })), { transaction });
    }
    await recordRoleAudit(m, {
      organizationId, actorUserId: actor.userId, action: 'role.cloned', role: created, details: { from: source.name, code: created.code },
    }, transaction);
    return created;
  });
  res.status(201).json({ data: role, message: 'Role copied.' });
});

const reset = endpoint(async (req, res, m, { organizationId, actor }) => {
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    if (!role.presetCode) throw fail(409, 'Only system roles have defaults to reset to.');
    assertPermissionsEditable(role);
    const ids = await templatePermissionIds(m, role.presetCode, transaction);
    const permissions = ids.length ? await m.Permission.findAll({ where: { id: ids }, transaction }) : [];
    await applyPermissions(m, role, permissions, actor, transaction, 'role.reset_to_defaults');
  });
  res.json({ message: 'Role reset to its default permissions.' });
});

const setPermissions = endpoint(async (req, res, m, { organizationId, actor }) => {
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    assertPermissionsEditable(role);
    const held = new Set((await role.getPermissions({ transaction, joinTableAttributes: [] })).map((permission) => permission.id));
    const permissions = await validatedPermissions(m, req.body?.permissionIds, transaction, held);
    await applyPermissions(m, role, permissions, actor, transaction);
  });
  res.json({ message: 'Role permissions updated.' });
});

const grant = endpoint(async (req, res, m, { organizationId, actor }) => {
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    assertPermissionsEditable(role);
    const current = await role.getPermissions({ transaction, joinTableAttributes: [] });
    const [permission] = await validatedPermissions(m, [req.body?.permissionId], transaction, new Set(current.map((row) => row.id)));
    if (!permission) throw fail(404, 'Permission not found.');
    await applyPermissions(m, role, [...current, permission], actor, transaction);
  });
  res.json({ message: 'Permission granted.' });
});

const revoke = endpoint(async (req, res, m, { organizationId, actor }) => {
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    assertPermissionsEditable(role);
    const current = await role.getPermissions({ transaction, joinTableAttributes: [] });
    await applyPermissions(m, role, current.filter((row) => row.id !== req.params.permissionId), actor, transaction);
  });
  res.json({ message: 'Permission removed.' });
});

const assign = endpoint(async (req, res, m, { organizationId, actor }) => {
  const userId = String(req.body?.userId || '').trim();
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    await addMemberRole(m, { organizationId, userId, roleId: role.id, actor, transaction });
  });
  await refreshMemberSockets(m, organizationId, userId);
  res.json({ message: 'Role assigned to organization member.' });
});

const unassign = endpoint(async (req, res, m, { organizationId, actor }) => {
  const userId = memberIdParam(req);
  await write(m, organizationId, async (transaction) => {
    const role = await findRole(m, req.params.id, organizationId, transaction);
    await removeMemberRole(m, { organizationId, userId, roleId: role.id, actor, transaction });
  });
  await refreshMemberSockets(m, organizationId, userId);
  res.json({ message: 'Role assignment removed.' });
});

const memberRoles = endpoint(async (req, res, m, { organizationId, actor }) => {
  const userId = memberIdParam(req);
  await ensureOrganizationRoles(m, organizationId, { actorUserId: actor.userId });
  const assignments = await memberAssignments(m, organizationId, userId);
  const roles = await m.OrganizationRole.findAll({ where: { organizationId, isActive: true } });
  // Someone invited but not yet signed in is still a member whose roles can be set.
  const membership = await m.OrganizationUser.findOne({ where: { organizationId, userId }, attributes: ['isActive'] });
  const isMember = membership ? membership.isActive : Boolean(await activeMember(m, userId, organizationId));
  res.json({
    data: {
      isMember,
      roleIds: assignments.map((assignment) => assignment.roleId),
      roles: [...roles].sort(bySystemRankThenName).map(({ id, name, code, description, presetCode }) => ({
        id, name, code, description, presetCode: presetCode || null, isSystem: Boolean(presetCode),
      })),
    },
  });
});

const setRolesForMember = endpoint(async (req, res, m, { organizationId, actor }) => {
  const userId = memberIdParam(req);
  if (!Array.isArray(req.body?.roleIds)) throw fail(400, 'roleIds must be a list.');
  await write(m, organizationId, async (transaction) => {
    await setMemberRoles(m, { organizationId, userId, roleIds: req.body.roleIds, actor, transaction });
    await syncMembershipLabel(m, organizationId, userId, transaction);
  });
  await refreshMemberSockets(m, organizationId, userId);
  res.json({ message: 'Member roles updated.' });
});

const auditLog = endpoint(async (req, res, m, { organizationId }) => {
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
  const { rows, count } = await m.OrganizationRoleAuditLog.findAndCountAll({
    where: { organizationId },
    include: [
      { model: m.User, as: 'actor', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
      { model: m.User, as: 'targetUser', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
    ],
    order: [['createdAt', 'DESC'], ['id', 'ASC']],
    limit,
    offset: (page - 1) * limit,
  });
  const parseDetails = (details) => {
    // MariaDB returns JSON columns as text.
    if (typeof details !== 'string') return details;
    try { return JSON.parse(details); } catch { return null; }
  };
  res.json({
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      roleId: row.roleId,
      roleName: row.roleName,
      details: parseDetails(row.details),
      createdAt: row.createdAt,
      actor: row.actor ? { id: row.actor.id, firstName: row.actor.firstName, lastName: row.actor.lastName, email: row.actor.email } : null,
      targetUser: row.targetUser ? { id: row.targetUser.id, firstName: row.targetUser.firstName, lastName: row.targetUser.lastName, email: row.targetUser.email } : null,
    })),
    meta: { page, limit, total: count, totalPages: Math.max(Math.ceil(count / limit), 1) },
  });
});

module.exports = {
  list, options, create, update, remove, clone, reset, setPermissions, grant, revoke, assign, unassign, memberRoles, setRolesForMember, auditLog,
};
