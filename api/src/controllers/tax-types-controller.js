const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

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
  const isActive = parseBoolean(body.isActive, true);
  return {
    code,
    name,
    description: description || null,
    percentage,
    isActive,
  };
}

async function listTaxTypes(req, res) {
  try {
    const models = getModels();
    if (!models || !models.TaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { TaxType } = models;
    const where = {};
    if (String(req.query.activeOnly || '').toLowerCase() === 'true') {
      where.isActive = true;
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where[Op.or] = [
        { code: { [Op.like]: `%${q}%` } },
        { name: { [Op.like]: `%${q}%` } },
      ];
    }

    const rows = await TaxType.findAll({
      where,
      order: [['name', 'ASC']],
      limit: 200,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Tax types fetched successfully.',
      data: rows,
      meta: { total: rows.length },
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to fetch tax types.' });
  }
}

async function createTaxType(req, res) {
  try {
    const models = getModels();
    if (!models || !models.TaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { TaxType } = models;
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

    const exists = await TaxType.findOne({ where: { code: payload.code } });
    if (exists) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Tax type code already exists.' });
    }

    const created = await TaxType.create(payload);
    return res.status(201).json({
      code: 'SUCCESS',
      message: 'Tax type created successfully.',
      data: created,
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to create tax type.' });
  }
}

async function updateTaxType(req, res) {
  try {
    const models = getModels();
    if (!models || !models.TaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { TaxType } = models;
    const row = await TaxType.findByPk(req.params.id);
    if (!row) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Tax type not found.' });
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

    const duplicate = await TaxType.findOne({
      where: {
        code: payload.code,
        id: { [Op.ne]: row.id },
      },
    });
    if (duplicate) {
      return res.status(409).json({ code: 'CONFLICT', message: 'Tax type code already exists.' });
    }

    await row.update(payload);
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Tax type updated successfully.',
      data: row,
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to update tax type.' });
  }
}

async function deleteTaxType(req, res) {
  try {
    const models = getModels();
    if (!models || !models.TaxType) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { TaxType } = models;
    const row = await TaxType.findByPk(req.params.id);
    if (!row) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Tax type not found.' });
    }
    if (row.isSystem) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'System tax type records cannot be deleted.',
      });
    }

    await row.destroy();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Tax type deleted successfully.',
    });
  } catch (err) {
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to delete tax type.' });
  }
}

module.exports = {
  listTaxTypes,
  createTaxType,
  updateTaxType,
  deleteTaxType,
};
