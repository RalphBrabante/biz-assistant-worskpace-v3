const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
} = require('../services/request-scope');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value).toLowerCase() === 'true';
}

function normalizePayload(body = {}) {
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const percentageRaw = body.percentage;
  const percentage = percentageRaw === undefined || percentageRaw === null || percentageRaw === ''
    ? null
    : Number(percentageRaw);
  const appliesToRaw = String(body.appliesTo || '').trim().toLowerCase();
  const appliesTo = ['expense', 'invoice', 'both'].includes(appliesToRaw) ? appliesToRaw : 'expense';
  const minimumBaseAmountRaw = body.minimumBaseAmount;
  const minimumBaseAmount = minimumBaseAmountRaw === undefined || minimumBaseAmountRaw === null || minimumBaseAmountRaw === ''
    ? 0
    : Number(minimumBaseAmountRaw);
  const isActive = parseBoolean(body.isActive, true);

  return {
    code,
    name,
    description: description || null,
    percentage,
    appliesTo,
    minimumBaseAmount,
    isActive,
  };
}

async function listWithholdingTaxTypes(req, res) {
  try {
    const models = getModels();
    if (!models || !models.WithholdingTaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { WithholdingTaxType } = models;
    const where = {};

    const authOrgId = getAuthenticatedOrganizationId(req);
    const queryOrgId = String(req.query.organizationId || '').trim();
    if (isPrivilegedRequest(req)) {
      if (queryOrgId) {
        where.organizationId = queryOrgId;
      }
    } else if (authOrgId) {
      where.organizationId = authOrgId;
    } else {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId is required for this user.' });
    }

    if (String(req.query.activeOnly || '').toLowerCase() === 'true') {
      where.isActive = true;
    }

    const appliesTo = String(req.query.appliesTo || '').trim().toLowerCase();
    if (appliesTo) {
      where.appliesTo = appliesTo === 'invoice' || appliesTo === 'expense'
        ? { [Op.in]: [appliesTo, 'both'] }
        : appliesTo;
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where[Op.or] = [
        { code: { [Op.like]: `%${q}%` } },
        { name: { [Op.like]: `%${q}%` } },
      ];
    }

    const rows = await WithholdingTaxType.findAll({
      where,
      order: [['name', 'ASC']],
      limit: 200,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Withholding tax types fetched successfully.',
      data: rows,
      meta: { total: rows.length },
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to fetch withholding tax types.' });
  }
}

async function createWithholdingTaxType(req, res) {
  try {
    const models = getModels();
    if (!models || !models.WithholdingTaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { WithholdingTaxType } = models;
    const payload = normalizePayload(req.body);
    const authOrgId = getAuthenticatedOrganizationId(req);
    const requestedOrgId = String(req.body?.organizationId || '').trim();
    const organizationId = isPrivilegedRequest(req) ? (requestedOrgId || authOrgId) : authOrgId;

    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId is required.' });
    }
    if (!payload.code) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'code is required.' });
    }
    if (!payload.name) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'name is required.' });
    }
    if (payload.percentage === null || !Number.isFinite(payload.percentage) || payload.percentage < 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'percentage must be a non-negative number.' });
    }
    if (!Number.isFinite(payload.minimumBaseAmount) || payload.minimumBaseAmount < 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'minimumBaseAmount must be a non-negative number.' });
    }

    const duplicate = await WithholdingTaxType.findOne({
      where: {
        organizationId,
        code: payload.code,
      },
    });
    if (duplicate) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Withholding tax code already exists for this organization.' });
    }

    const created = await WithholdingTaxType.create({
      ...payload,
      organizationId,
      createdBy: req.auth?.user?.id || null,
      updatedBy: req.auth?.user?.id || null,
    });

    return res.status(201).json({
      code: 'SUCCESS',
      message: 'Withholding tax type created successfully.',
      data: created,
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to create withholding tax type.' });
  }
}

async function updateWithholdingTaxType(req, res) {
  try {
    const models = getModels();
    if (!models || !models.WithholdingTaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { WithholdingTaxType } = models;
    const row = await WithholdingTaxType.findByPk(req.params.id);
    if (!row) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Withholding tax type not found.' });
    }

    const authOrgId = getAuthenticatedOrganizationId(req);
    if (!isPrivilegedRequest(req) && row.organizationId !== authOrgId) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Withholding tax type not found.' });
    }

    const payload = normalizePayload(req.body);
    if (!payload.code) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'code is required.' });
    }
    if (!payload.name) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'name is required.' });
    }
    if (payload.percentage === null || !Number.isFinite(payload.percentage) || payload.percentage < 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'percentage must be a non-negative number.' });
    }
    if (!Number.isFinite(payload.minimumBaseAmount) || payload.minimumBaseAmount < 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'minimumBaseAmount must be a non-negative number.' });
    }

    const duplicate = await WithholdingTaxType.findOne({
      where: {
        organizationId: row.organizationId,
        code: payload.code,
        id: { [Op.ne]: row.id },
      },
    });
    if (duplicate) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Withholding tax code already exists for this organization.' });
    }

    await row.update({
      ...payload,
      updatedBy: req.auth?.user?.id || null,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Withholding tax type updated successfully.',
      data: row,
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to update withholding tax type.' });
  }
}

async function deleteWithholdingTaxType(req, res) {
  try {
    const models = getModels();
    if (!models || !models.WithholdingTaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { WithholdingTaxType } = models;
    const row = await WithholdingTaxType.findByPk(req.params.id);
    if (!row) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Withholding tax type not found.' });
    }
    if (row.isSystem) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'System withholding tax type records cannot be deleted.',
      });
    }

    const authOrgId = getAuthenticatedOrganizationId(req);
    if (!isPrivilegedRequest(req) && row.organizationId !== authOrgId) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Withholding tax type not found.' });
    }

    await row.destroy();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Withholding tax type deleted successfully.',
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to delete withholding tax type.' });
  }
}

module.exports = {
  listWithholdingTaxTypes,
  createWithholdingTaxType,
  updateWithholdingTaxType,
  deleteWithholdingTaxType,
};
