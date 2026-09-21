const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function getPermissionModel() {
  const models = getModels();
  if (!models || !models.Permission) {
    return null;
  }
  return models.Permission;
}

function pickPermissionPayload(body = {}) {
  return {
    name: body.name,
    code: body.code,
    resource: body.resource,
    action: body.action,
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

async function createPermission(req, res) {
  try {
    const Permission = getPermissionModel();
    if (!Permission) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickPermissionPayload(req.body));
    if (payload.code) payload.code = String(payload.code).toLowerCase().trim();
    if (payload.resource) payload.resource = String(payload.resource).toLowerCase().trim();
    if (payload.action) payload.action = String(payload.action).toLowerCase().trim();

    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }
    if (!payload.code) {
      return res.status(400).json({ ok: false, message: 'code is required.' });
    }
    if (!payload.resource) {
      return res.status(400).json({ ok: false, message: 'resource is required.' });
    }
    if (!payload.action) {
      return res.status(400).json({ ok: false, message: 'action is required.' });
    }

    const permission = await Permission.create(payload);
    return res.status(201).json({ ok: true, data: permission });
  } catch (err) {
    console.error('Create permission error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create permission.' });
  }
}

async function listPermissions(req, res) {
  try {
    const Permission = getPermissionModel();
    if (!Permission) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.resource) where.resource = req.query.resource;
    if (req.query.action) where.action = req.query.action;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) where.isActive = isActive;

    const isSystem = parseBoolean(req.query.isSystem);
    if (isSystem !== undefined) where.isSystem = isSystem;

    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { code: { [Op.like]: `%${req.query.q}%` } },
        { resource: { [Op.like]: `%${req.query.q}%` } },
        { action: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Permission.findAndCountAll({
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
    console.error('List permissions error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch permissions.' });
  }
}

async function getPermissionById(req, res) {
  try {
    const Permission = getPermissionModel();
    if (!Permission) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const permission = await Permission.findByPk(req.params.id);
    if (!permission) {
      return res.status(404).json({ ok: false, message: 'Permission not found.' });
    }

    return res.status(200).json({ ok: true, data: permission });
  } catch (err) {
    console.error('Get permission error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch permission.' });
  }
}

async function updatePermission(req, res) {
  try {
    const Permission = getPermissionModel();
    if (!Permission) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const permission = await Permission.findByPk(req.params.id);
    if (!permission) {
      return res.status(404).json({ ok: false, message: 'Permission not found.' });
    }

    const payload = cleanUndefined(pickPermissionPayload(req.body));
    if (payload.code) payload.code = String(payload.code).toLowerCase().trim();
    if (payload.resource) payload.resource = String(payload.resource).toLowerCase().trim();
    if (payload.action) payload.action = String(payload.action).toLowerCase().trim();

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    await permission.update(payload);
    return res.status(200).json({ ok: true, data: permission });
  } catch (err) {
    console.error('Update permission error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update permission.' });
  }
}

async function deletePermission(req, res) {
  try {
    const Permission = getPermissionModel();
    if (!Permission) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const permission = await Permission.findByPk(req.params.id);
    if (!permission) {
      return res.status(404).json({ ok: false, message: 'Permission not found.' });
    }
    if (permission.isSystem) {
      return res.status(403).json({
        ok: false,
        message: 'System permission records cannot be deleted.',
      });
    }

    await permission.destroy();
    return res.status(200).json({ ok: true, message: 'Permission deleted successfully.' });
  } catch (err) {
    console.error('Delete permission error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete permission.' });
  }
}

module.exports = {
  createPermission,
  listPermissions,
  getPermissionById,
  updatePermission,
  deletePermission,
};
