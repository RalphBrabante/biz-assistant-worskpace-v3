const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const { getModels } = require('../sequelize');
const { isPrivilegedRequest } = require('../services/request-scope');

const ALLOWED_VENDOR_CATEGORIES = new Set(['goods', 'operations', 'others']);

function resolveOrganizationId(req, fallback = null) {
  const authOrgId = req.auth?.user?.organizationId || null;
  if (isPrivilegedRequest(req)) {
    return req.query.organizationId || fallback || authOrgId;
  }
  return authOrgId;
}

function getAuthenticatedUserId(req) {
  return req.auth?.user?.id || req.auth?.userId || null;
}

function normalizeIdList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    } catch (_err) {
      return [];
    }
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

async function userHasActiveOrganizationMembership(models, userId, organizationId) {
  if (!models?.OrganizationUser || !userId || !organizationId) {
    return false;
  }

  const membership = await models.OrganizationUser.findOne({
    where: {
      userId,
      organizationId,
      isActive: true,
    },
    attributes: ['id'],
  });

  return Boolean(membership);
}

async function userCanAccessOrganization(models, req, organizationId) {
  if (isPrivilegedRequest(req)) {
    return true;
  }
  const authOrgId = req.auth?.user?.organizationId || null;
  if (authOrgId && authOrgId === organizationId) {
    return true;
  }
  return userHasActiveOrganizationMembership(models, getAuthenticatedUserId(req), organizationId);
}

async function resolveListOrganizationId(req, models) {
  const requestedOrganizationId = String(req.query.organizationId || '').trim();
  const fallback = resolveOrganizationId(req);
  const organizationId = requestedOrganizationId || fallback;
  if (!organizationId) {
    return '';
  }
  if (!await userCanAccessOrganization(models, req, organizationId)) {
    return '';
  }
  return organizationId;
}

async function resolveAllowedOrganizationIds(req, models, ownerOrganizationId) {
  const requestedIds = normalizeIdList(req.body?.organizationIds);
  const ids = Array.from(new Set([ownerOrganizationId, ...requestedIds].filter(Boolean)));
  const allowedIds = [];
  for (const organizationId of ids) {
    // eslint-disable-next-line no-await-in-loop
    if (await userCanAccessOrganization(models, req, organizationId)) {
      allowedIds.push(organizationId);
    }
  }
  return allowedIds;
}

async function vendorIdsLinkedToOrganization(models, organizationId) {
  if (!models.VendorOrganization || !organizationId) {
    return [];
  }
  const links = await models.VendorOrganization.findAll({
    where: { organizationId },
    attributes: ['vendorId'],
  });
  return links.map((link) => link.vendorId).filter(Boolean);
}

async function vendorAccessWhere(models, req, vendorId) {
  const where = { id: vendorId };
  if (isPrivilegedRequest(req)) {
    return where;
  }

  const organizationId = resolveOrganizationId(req);
  if (!organizationId) {
    return null;
  }
  const linkedVendorIds = await vendorIdsLinkedToOrganization(models, organizationId);
  return {
    id: vendorId,
    [Op.or]: [
      { organizationId },
      ...(linkedVendorIds.length > 0 ? [{ id: { [Op.in]: linkedVendorIds } }] : []),
    ],
  };
}

async function syncVendorOrganizations(models, vendor, organizationIds, actorId) {
  if (!models.VendorOrganization || !vendor?.id) {
    return;
  }
  const ids = Array.from(new Set([vendor.organizationId, ...organizationIds].filter(Boolean)));
  await models.VendorOrganization.destroy({
    where: {
      vendorId: vendor.id,
      organizationId: { [Op.notIn]: ids },
    },
  });
  for (const organizationId of ids) {
    // eslint-disable-next-line no-await-in-loop
    const [link] = await models.VendorOrganization.findOrCreate({
      where: {
        vendorId: vendor.id,
        organizationId,
      },
      defaults: {
        vendorId: vendor.id,
        organizationId,
        isOwner: organizationId === vendor.organizationId,
        createdBy: actorId || null,
        updatedBy: actorId || null,
      },
    });
    if (link.isOwner !== (organizationId === vendor.organizationId) || link.updatedBy !== (actorId || null)) {
      // eslint-disable-next-line no-await-in-loop
      await link.update({
        isOwner: organizationId === vendor.organizationId,
        updatedBy: actorId || null,
      });
    }
  }
}

async function findVendorTaxConflict(models, taxId, organizationIds, excludeVendorId = null) {
  const cleanedTaxId = String(taxId || '').trim();
  if (!cleanedTaxId) {
    return null;
  }

  for (const organizationId of organizationIds) {
    // eslint-disable-next-line no-await-in-loop
    const linkedVendorIds = await vendorIdsLinkedToOrganization(models, organizationId);
    const where = {
      taxId: cleanedTaxId,
      [Op.and]: [
        {
          [Op.or]: [
            { organizationId },
            ...(linkedVendorIds.length > 0 ? [{ id: { [Op.in]: linkedVendorIds } }] : []),
          ],
        },
      ],
    };
    if (excludeVendorId) {
      where.id = { [Op.ne]: excludeVendorId };
    }
    // eslint-disable-next-line no-await-in-loop
    const existing = await models.Vendor.findOne({
      where,
      attributes: ['id', 'name', 'taxId'],
    });
    if (existing) {
      return existing;
    }
  }

  return null;
}

function vendorInclude(models) {
  return [
    {
      model: models.Organization,
      as: 'organization',
      attributes: ['id', 'name', 'legalName'],
      required: false,
    },
    {
      association: 'organizations',
      attributes: ['id', 'name', 'legalName'],
      through: { attributes: ['isOwner'] },
      required: false,
    },
  ];
}

function pickVendorPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    name: body.name,
    legalName: body.legalName,
    taxId: body.taxId,
    category: body.category,
    contactPerson: body.contactPerson,
    contactEmail: body.contactEmail,
    phone: body.phone,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    barangay: body.barangay,
    province: body.province,
    postalCode: body.postalCode,
    country: body.country,
    paymentTerms: body.paymentTerms,
    notes: body.notes,
    status: body.status,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function normalizeVendorCategory(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) {
    return 'others';
  }
  return value;
}

function cleanUndefined(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
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

async function importVendors(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.VendorOrganization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'CSV file is required.' });
    }

    const records = parse(req.file.buffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'CSV file has no rows to import.' });
    }

    const organizationId = resolveOrganizationId(req, req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const { Vendor } = models;
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
        name,
        category: normalizeVendorCategory(row.category),
        legalName: String(row.legalName || '').trim() || undefined,
        taxId: String(row.taxId || '').trim() || undefined,
        contactPerson: String(row.contactPerson || '').trim() || undefined,
        contactEmail: String(row.contactEmail || '').trim() || undefined,
        phone: String(row.phone || '').trim() || undefined,
        addressLine1: String(row.addressLine1 || '').trim() || undefined,
        addressLine2: String(row.addressLine2 || '').trim() || undefined,
        city: String(row.city || '').trim() || undefined,
        state: String(row.state || '').trim() || undefined,
        barangay: String(row.barangay || '').trim() || undefined,
        province: String(row.province || '').trim() || undefined,
        postalCode: String(row.postalCode || '').trim() || undefined,
        country: String(row.country || '').trim() || undefined,
        paymentTerms: String(row.paymentTerms || '').trim() || undefined,
        notes: String(row.notes || '').trim() || undefined,
        status: String(row.status || '').trim().toLowerCase() || 'active',
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });
      if (!ALLOWED_VENDOR_CATEGORIES.has(payload.category)) {
        skipped += 1;
        errors.push(`Row ${rowNum}: category must be one of goods, operations, others.`);
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const vendor = await Vendor.create(payload);
        await syncVendorOrganizations(models, vendor, [organizationId], req.auth?.user?.id || null);
        imported += 1;
      } catch (rowErr) {
        skipped += 1;
        errors.push(`Row ${rowNum}: ${rowErr.message || 'failed to import row.'}`);
      }
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: `Vendor import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function exportVendors(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.VendorOrganization || !models.Organization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const organizationId = await resolveListOrganizationId(req, models);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const linkedVendorIds = await vendorIdsLinkedToOrganization(models, organizationId);
    const where = {
      [Op.and]: [
        {
          [Op.or]: [
            { organizationId },
            ...(linkedVendorIds.length > 0 ? [{ id: { [Op.in]: linkedVendorIds } }] : []),
          ],
        },
      ],
    };
    if (req.query.status) {
      where.status = String(req.query.status).toLowerCase();
    }
    if (String(req.query.activeOnly || '').toLowerCase() === 'true') {
      where.status = 'active';
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where[Op.and].push({
        [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { category: { [Op.like]: `%${q}%` } },
          { legalName: { [Op.like]: `%${q}%` } },
          { taxId: { [Op.like]: `%${q}%` } },
          { contactPerson: { [Op.like]: `%${q}%` } },
          { contactEmail: { [Op.like]: `%${q}%` } },
          { barangay: { [Op.like]: `%${q}%` } },
          { province: { [Op.like]: `%${q}%` } },
        ],
      });
    }

    const { Vendor } = models;
    const rows = await Vendor.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'name',
      'legalName',
      'taxId',
      'category',
      'contactPerson',
      'contactEmail',
      'phone',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'barangay',
      'province',
      'postalCode',
      'country',
      'paymentTerms',
      'status',
      'notes',
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
          csvValue(json.name),
          csvValue(json.legalName),
          csvValue(json.taxId),
          csvValue(json.category),
          csvValue(json.contactPerson),
          csvValue(json.contactEmail),
          csvValue(json.phone),
          csvValue(json.addressLine1),
          csvValue(json.addressLine2),
          csvValue(json.city),
          csvValue(json.state),
          csvValue(json.barangay),
          csvValue(json.province),
          csvValue(json.postalCode),
          csvValue(json.country),
          csvValue(json.paymentTerms),
          csvValue(json.status),
          csvValue(json.notes),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"vendors-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
}

async function listVendors(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.Organization || !models.VendorOrganization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const organizationId = await resolveListOrganizationId(req, models);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const linkedVendorIds = await vendorIdsLinkedToOrganization(models, organizationId);
    const scopeOr = [
      { organizationId },
      ...(linkedVendorIds.length > 0 ? [{ id: { [Op.in]: linkedVendorIds } }] : []),
    ];
    const where = {
      [Op.and]: [
        { [Op.or]: scopeOr },
      ],
    };
    if (req.query.status) {
      where.status = String(req.query.status).toLowerCase();
    }
    if (String(req.query.activeOnly || '').toLowerCase() === 'true') {
      where.status = 'active';
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      where[Op.and].push({
        [Op.or]: [
          { name: { [Op.like]: `%${q}%` } },
          { category: { [Op.like]: `%${q}%` } },
          { legalName: { [Op.like]: `%${q}%` } },
          { taxId: { [Op.like]: `%${q}%` } },
          { contactPerson: { [Op.like]: `%${q}%` } },
          { contactEmail: { [Op.like]: `%${q}%` } },
          { barangay: { [Op.like]: `%${q}%` } },
          { province: { [Op.like]: `%${q}%` } },
        ],
      });
    }

    const { Vendor } = models;
    const { rows, count } = await Vendor.findAndCountAll({
      where,
      include: vendorInclude(models),
      distinct: true,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Vendors fetched successfully.',
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function createVendor(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.VendorOrganization || !models.Organization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const organizationId = resolveOrganizationId(req, req.body?.organizationId);
    if (!organizationId) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const payload = cleanUndefined(pickVendorPayload(req.body));
    payload.organizationId = organizationId;
    payload.category = normalizeVendorCategory(payload.category);
    payload.createdBy = req.auth?.user?.id || payload.createdBy || null;
    payload.updatedBy = req.auth?.user?.id || payload.updatedBy || null;

    if (!payload.name) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'name is required.' });
    }
    if (!ALLOWED_VENDOR_CATEGORIES.has(payload.category)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'category must be one of: goods, operations, others.',
      });
    }

    const { Vendor } = models;
    const actorId = req.auth?.user?.id || req.auth?.userId || null;
    const organizationIds = await resolveAllowedOrganizationIds(req, models, organizationId);
    if (!organizationIds.includes(organizationId)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'You do not have access to this organization.' });
    }

    const taxId = String(payload.taxId || '').trim();
    const existing = await findVendorTaxConflict(models, taxId, organizationIds);
    if (existing) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: `A vendor with TIN "${taxId}" already exists (${existing.name}).`,
      });
    }

    const vendor = await Vendor.create(payload);
    await syncVendorOrganizations(models, vendor, organizationIds, actorId);
    const created = await Vendor.findByPk(vendor.id, {
      include: vendorInclude(models),
    });

    return res.status(201).json({
      code: 'CREATED',
      message: 'Vendor created successfully.',
      data: created || vendor,
    });
  } catch (err) {
    return next(err);
  }
}

async function getVendorById(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.Organization || !models.VendorOrganization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Vendor } = models;
    const where = await vendorAccessWhere(models, req, req.params.id);
    if (!where) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const vendor = await Vendor.findOne({
      where,
      include: vendorInclude(models),
    });

    if (!vendor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
    }

    return res.status(200).json({ code: 'SUCCESS', message: 'Vendor fetched successfully.', data: vendor });
  } catch (err) {
    return next(err);
  }
}

async function updateVendor(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.VendorOrganization || !models.Organization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Vendor } = models;
    const where = await vendorAccessWhere(models, req, req.params.id);
    if (!where) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const vendor = await Vendor.findOne({
      where,
    });

    if (!vendor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
    }

    const payload = cleanUndefined(pickVendorPayload(req.body));
    delete payload.organizationId;
    if (payload.category !== undefined) {
      payload.category = normalizeVendorCategory(payload.category);
      if (!ALLOWED_VENDOR_CATEGORIES.has(payload.category)) {
        return res.status(400).json({
          code: 'BAD_REQUEST',
          message: 'category must be one of: goods, operations, others.',
        });
      }
    }
    const actorId = req.auth?.user?.id || req.auth?.userId || payload.updatedBy || vendor.updatedBy || null;
    payload.updatedBy = actorId;

    const organizationIds = await resolveAllowedOrganizationIds(req, models, vendor.organizationId);
    const effectiveTaxId = Object.prototype.hasOwnProperty.call(payload, 'taxId') ? payload.taxId : vendor.taxId;
    const existing = await findVendorTaxConflict(models, effectiveTaxId, organizationIds, vendor.id);
    if (existing) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: `A vendor with TIN "${effectiveTaxId}" already exists (${existing.name}).`,
      });
    }

    await vendor.update(payload);
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'organizationIds')) {
      await syncVendorOrganizations(models, vendor, organizationIds, actorId);
    }
    const updated = await Vendor.findByPk(vendor.id, {
      include: vendorInclude(models),
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Vendor updated successfully.',
      data: updated || vendor,
    });
  } catch (err) {
    return next(err);
  }
}

async function deleteVendor(req, res, next) {
  try {
    const models = getModels();
    if (!models || !models.Vendor || !models.VendorOrganization) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Vendor } = models;
    const where = await vendorAccessWhere(models, req, req.params.id);
    if (!where) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId could not be resolved from authenticated user.' });
    }

    const vendor = await Vendor.findOne({
      where,
    });

    if (!vendor) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Vendor not found.' });
    }

    await vendor.destroy();

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Vendor deleted successfully.',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listVendors,
  importVendors,
  exportVendors,
  createVendor,
  getVendorById,
  updateVendor,
  deleteVendor,
};
