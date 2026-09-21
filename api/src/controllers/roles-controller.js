const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function getRoleModel() {
  const models = getModels();
  if (!models || !models.Role) {
    return null;
  }
  return models.Role;
}

function getRolePermissionModels() {
  const models = getModels();
  if (!models || !models.Role || !models.Permission || !models.RolePermission) {
    return null;
  }
  return {
    Role: models.Role,
    Permission: models.Permission,
    RolePermission: models.RolePermission,
  };
}

function pickRolePayload(body = {}) {
  return {
    name: body.name,
    code: body.code,
    description: body.description,
    isSystem: body.isSystem,
    isActive: body.isActive,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
}

async function createRole(req, res) {
  try {
    const Role = getRoleModel();
    if (!Role) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickRolePayload(req.body));
    if (payload.code) {
      payload.code = String(payload.code).toLowerCase().trim();
    }

    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }
    if (!payload.code) {
      return res.status(400).json({ ok: false, message: 'code is required.' });
    }

    const role = await Role.create(payload);
    return res.status(201).json({ ok: true, data: role });
  } catch (err) {
    console.error('Create role error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create role.' });
  }
}

async function listRoles(req, res) {
  try {
    const Role = getRoleModel();
    if (!Role) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) where.isActive = isActive;
    const isSystem = parseBoolean(req.query.isSystem);
    if (isSystem !== undefined) where.isSystem = isSystem;

    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { code: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Role.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List roles error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch roles.' });
  }
}

async function getRoleById(req, res) {
  try {
    const models = getRolePermissionModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Role, Permission } = models;

    const role = await Role.findByPk(req.params.id, {
      include: [
        {
          model: Permission,
          as: 'permissions',
          through: { attributes: ['id', 'isAllowed', 'scope', 'isActive', 'createdAt'] },
        },
      ],
    });
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found.' });
    }

    return res.status(200).json({ ok: true, data: role });
  } catch (err) {
    console.error('Get role error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch role.' });
  }
}

async function updateRole(req, res) {
  try {
    const Role = getRoleModel();
    if (!Role) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found.' });
    }

    const payload = cleanUndefined(pickRolePayload(req.body));
    if (payload.code) {
      payload.code = String(payload.code).toLowerCase().trim();
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    await role.update(payload);
    return res.status(200).json({ ok: true, data: role });
  } catch (err) {
    console.error('Update role error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update role.' });
  }
}

async function deleteRole(req, res) {
  try {
    const Role = getRoleModel();
    if (!Role) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found.' });
    }
    if (role.isSystem) {
      return res.status(403).json({
        ok: false,
        message: 'System role records cannot be deleted.',
      });
    }

    await role.destroy();
    return res.status(200).json({ ok: true, message: 'Role deleted successfully.' });
  } catch (err) {
    console.error('Delete role error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete role.' });
  }
}

async function listRoleAssignablePermissions(req, res) {
  try {
    const models = getRolePermissionModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Role, Permission } = models;

    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found.' });
    }

    const permissions = await Permission.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'code', 'resource', 'action', 'description', 'isActive'],
      order: [['code', 'ASC']],
    });

    return res.status(200).json({
      ok: true,
      data: permissions,
      meta: { total: permissions.length },
    });
  } catch (err) {
    console.error('List role assignable permissions error:', err);
    return res
      .status(500)
      .json({ ok: false, message: 'Unable to fetch assignable permissions.' });
  }
}

async function addPermissionToRole(req, res) {
  try {
    const models = getRolePermissionModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Role, Permission, RolePermission } = models;

    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found.' });
    }

    const permissionId = String(req.body?.permissionId || '').trim();
    if (!permissionId) {
      return res.status(400).json({ ok: false, message: 'permissionId is required.' });
    }

    const permission = await Permission.findOne({ where: { id: permissionId, isActive: true } });
    if (!permission) {
      return res.status(404).json({ ok: false, message: 'Permission not found or inactive.' });
    }

    const [rolePermission] = await RolePermission.findOrCreate({
      where: { roleId: role.id, permissionId: permission.id },
      defaults: {
        isAllowed: true,
        isActive: true,
        assignedByUserId: req.auth?.user?.id || null,
      },
    });

    if (!rolePermission.isActive || rolePermission.isAllowed !== true) {
      await rolePermission.update({
        isActive: true,
        isAllowed: true,
      });
    }

    return res.status(201).json({
      ok: true,
      message: 'Permission added to role successfully.',
      data: rolePermission,
    });
  } catch (err) {
    console.error('Add permission to role error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to add permission to role.' });
  }
}

async function removePermissionFromRole(req, res) {
  try {
    const models = getRolePermissionModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Role, RolePermission } = models;

    const role = await Role.findByPk(req.params.id);
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found.' });
    }

    const permissionId = String(req.params.permissionId || '').trim();
    if (!permissionId) {
      return res.status(400).json({ ok: false, message: 'permissionId is required.' });
    }

    const rolePermission = await RolePermission.findOne({
      where: {
        roleId: role.id,
        permissionId,
      },
    });

    if (!rolePermission) {
      return res.status(404).json({ ok: false, message: 'Role permission assignment not found.' });
    }

    await rolePermission.destroy();
    return res
      .status(200)
      .json({ ok: true, message: 'Permission removed from role successfully.' });
  } catch (err) {
    console.error('Remove permission from role error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove permission from role.' });
  }
}

module.exports = {
  createRole,
  listRoles,
  getRoleById,
  updateRole,
  deleteRole,
  listRoleAssignablePermissions,
  addPermissionToRole,
  removePermissionFromRole,
};
