const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const {
  createOrganizationMessage,
  getActorDisplayName,
} = require('../services/message-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getItemModels() {
  const models = getModels();
  if (!models || !models.Item || !models.Organization || !models.Vendor) {
    return null;
  }
  return {
    Item: models.Item,
    Organization: models.Organization,
    Vendor: models.Vendor,
  };
}

function pickItemPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    vendorId: body.vendorId,
    type: body.type,
    sku: body.sku,
    name: body.name,
    description: body.description,
    category: body.category,
    unit: body.unit,
    price: body.price,
    cost: body.cost,
    discountedPrice: body.discountedPrice,
    currency: body.currency,
    stock: body.stock,
    reorderLevel: body.reorderLevel,
    taxRate: body.taxRate,
    isActive: body.isActive,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
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

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function resolveImportOrganizationId(req) {
  if (!isPrivilegedRequest(req)) {
    return getAuthenticatedOrganizationId(req);
  }
  return req.body?.organizationId || req.query?.organizationId || getAuthenticatedOrganizationId(req);
}

async function createItem(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item, Vendor } = models;

    const payload = cleanUndefined(pickItemPayload(req.body));

    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }

    if (payload.vendorId) {
      const vendor = await Vendor.findOne({
        where: {
          id: payload.vendorId,
          organizationId: payload.organizationId,
        },
      });
      if (!vendor) {
        return res.status(400).json({ ok: false, message: 'Selected vendor is invalid for this organization.' });
      }
    }

    payload.currency = await getOrganizationCurrency(payload.organizationId);

    const item = await Item.create(payload);
    const actorName = getActorDisplayName(req.auth?.user);
    await createOrganizationMessage({
      organizationId: item.organizationId,
      entityType: 'item',
      entityId: item.id,
      title: 'New item added',
      message: `${actorName} just created item "${item.name}".`,
      createdBy: req.auth?.user?.id || req.auth?.userId || null,
      metadata: {
        sku: item.sku || null,
        type: item.type || null,
      },
    });
    const created = await Item.findByPk(item.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          association: 'vendor',
          attributes: ['id', 'name', 'legalName', 'taxId'],
          required: false,
        },
      ],
    });
    return res.status(201).json({ ok: true, data: created || item });
  } catch (err) {
    console.error('Create item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create item.' });
  }
}

async function listItems(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.organizationId) {
      where.organizationId = req.query.organizationId;
    }
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.type) {
      where.type = req.query.type;
    }
    if (req.query.vendorId) {
      where.vendorId = req.query.vendorId;
    }
    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }
    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { sku: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.legal_name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.tax_id$': { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Item.findAndCountAll({
      where,
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          association: 'vendor',
          attributes: ['id', 'name', 'legalName', 'taxId'],
          required: false,
        },
      ],
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
    console.error('List items error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch items.' });
  }
}

async function importItems(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, message: 'CSV file is required.' });
    }

    const records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ ok: false, message: 'CSV file has no rows to import.' });
    }

    const organizationId = resolveImportOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const { Item } = models;
    const currency = await getOrganizationCurrency(organizationId);
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      const row = records[index];
      const rowNum = index + 2;
      const name = String(row.name || '').trim();

      if (!name) {
        skipped += 1;
        errors.push(`Row ${rowNum}: name is required.`);
        continue;
      }

      const payload = cleanUndefined({
        organizationId,
        type: String(row.type || '').trim().toLowerCase() || 'product',
        vendorId: String(row.vendorId || '').trim() || undefined,
        sku: String(row.sku || '').trim() || undefined,
        name,
        description: String(row.description || '').trim() || undefined,
        category: String(row.category || '').trim() || undefined,
        unit: String(row.unit || '').trim() || undefined,
        price: toNullableNumber(row.price),
        cost: toNullableNumber(row.cost),
        discountedPrice: toNullableNumber(row.discountedPrice),
        stock: toNullableNumber(row.stock),
        reorderLevel: toNullableNumber(row.reorderLevel),
        taxRate: toNullableNumber(row.taxRate),
        isActive: parseBoolean(row.isActive) ?? true,
        currency,
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });

      try {
        if (payload.vendorId) {
          // eslint-disable-next-line no-await-in-loop
          const vendor = await models.Vendor.findOne({
            where: {
              id: payload.vendorId,
              organizationId,
            },
          });
          if (!vendor) {
            skipped += 1;
            errors.push(`Row ${rowNum}: vendorId is invalid for this organization.`);
            continue;
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await Item.create(payload);
        imported += 1;
      } catch (rowErr) {
        skipped += 1;
        errors.push(`Row ${rowNum}: ${rowErr.message || 'failed to import row.'}`);
      }
    }

    return res.status(200).json({
      ok: true,
      message: `Item import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    console.error('Import items error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to import items.' });
  }
}

async function exportItems(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const where = {};
    if (req.query.organizationId) {
      where.organizationId = req.query.organizationId;
    }
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.type) {
      where.type = req.query.type;
    }
    if (req.query.vendorId) {
      where.vendorId = req.query.vendorId;
    }
    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }
    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { sku: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.legal_name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.tax_id$': { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const rows = await Item.findAll({
      where,
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'legalName', 'taxId'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'type',
      'vendorId',
      'vendorName',
      'sku',
      'name',
      'description',
      'category',
      'unit',
      'price',
      'cost',
      'discountedPrice',
      'currency',
      'stock',
      'reorderLevel',
      'taxRate',
      'isActive',
      'createdAt',
      'updatedAt',
    ];

    const lines = [headers.join(',')];
    for (const row of rows) {
      const json = row.toJSON();
      lines.push(
        [
          csvValue(json.id),
          csvValue(json.organizationId),
          csvValue(json.type),
          csvValue(json.vendorId),
          csvValue(json.vendor?.name || json.vendor?.legalName),
          csvValue(json.sku),
          csvValue(json.name),
          csvValue(json.description),
          csvValue(json.category),
          csvValue(json.unit),
          csvValue(json.price),
          csvValue(json.cost),
          csvValue(json.discountedPrice),
          csvValue(json.currency),
          csvValue(json.stock),
          csvValue(json.reorderLevel),
          csvValue(json.taxRate),
          csvValue(json.isActive),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"items-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export items error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to export items.' });
  }
}

async function getItemById(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Item not found.' });
      }
    }

    const item = await Item.findOne({
      where,
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          association: 'vendor',
          attributes: ['id', 'name', 'legalName', 'taxId'],
          required: false,
        },
      ],
    });
    if (!item) {
      return res.status(404).json({ ok: false, message: 'Item not found.' });
    }

    return res.status(200).json({ ok: true, data: item });
  } catch (err) {
    console.error('Get item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch item.' });
  }
}

async function updateItem(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item, Vendor } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Item not found.' });
      }
    }

    const item = await Item.findOne({ where });
    if (!item) {
      return res.status(404).json({ ok: false, message: 'Item not found.' });
    }

    const payload = cleanUndefined(pickItemPayload(req.body));
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'vendorId') && !req.body.vendorId) {
      payload.vendorId = null;
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    const effectiveOrganizationId = payload.organizationId || item.organizationId;

    if (Object.prototype.hasOwnProperty.call(payload, 'vendorId') && payload.vendorId) {
      const vendor = await Vendor.findOne({
        where: {
          id: payload.vendorId,
          organizationId: effectiveOrganizationId,
        },
      });
      if (!vendor) {
        return res.status(400).json({ ok: false, message: 'Selected vendor is invalid for this organization.' });
      }
    }

    payload.currency = await getOrganizationCurrency(effectiveOrganizationId);

    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }

    await item.update(payload);
    const updated = await Item.findByPk(item.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          association: 'vendor',
          attributes: ['id', 'name', 'legalName', 'taxId'],
          required: false,
        },
      ],
    });
    return res.status(200).json({ ok: true, data: updated || item });
  } catch (err) {
    console.error('Update item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update item.' });
  }
}

async function deleteItem(req, res) {
  try {
    const models = getItemModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Item } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Item not found.' });
      }
    }

    const item = await Item.findOne({ where });
    if (!item) {
      return res.status(404).json({ ok: false, message: 'Item not found.' });
    }

    await item.destroy();
    return res.status(200).json({ ok: true, message: 'Item deleted successfully.' });
  } catch (err) {
    console.error('Delete item error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete item.' });
  }
}

module.exports = {
  createItem,
  importItems,
  exportItems,
  listItems,
  getItemById,
  updateItem,
  deleteItem,
};
