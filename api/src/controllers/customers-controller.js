const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const { getModels } = require('../sequelize');
const {
  createOrganizationMessage,
  getActorDisplayName,
} = require('../services/message-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getCustomerModels() {
  const models = getModels();
  if (!models || !models.Customer || !models.Organization) {
    return null;
  }
  return {
    Customer: models.Customer,
    Organization: models.Organization,
  };
}

function pickCustomerPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    customerCode: body.customerCode,
    type: body.type,
    name: body.name,
    legalName: body.legalName,
    taxId: body.taxId,
    contactPerson: body.contactPerson,
    email: body.email,
    phone: body.phone,
    mobile: body.mobile,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    postalCode: body.postalCode,
    country: body.country,
    creditLimit: body.creditLimit,
    paymentTermsDays: body.paymentTermsDays,
    status: body.status,
    notes: body.notes,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
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

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function resolveImportOrganizationId(req) {
  if (!isPrivilegedRequest(req)) {
    return getAuthenticatedOrganizationId(req);
  }
  return req.body?.organizationId || req.query?.organizationId || getAuthenticatedOrganizationId(req);
}

async function importCustomers(req, res) {
  try {
    const models = getCustomerModels();
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

    const { Customer } = models;
    const organizationId = resolveImportOrganizationId(req);

    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      const row = records[index];
      const rowNum = index + 2;
      const name = String(row.name || '').trim();
      const taxId = String(row.taxId || '').trim();
      if (!name || !taxId) {
        skipped += 1;
        errors.push(`Row ${rowNum}: name and taxId are required.`);
        continue;
      }

      const payload = cleanUndefined({
        organizationId,
        customerCode: String(row.customerCode || '').trim() || undefined,
        type: String(row.type || '').trim() || 'business',
        name,
        legalName: String(row.legalName || '').trim() || undefined,
        taxId,
        contactPerson: String(row.contactPerson || '').trim() || undefined,
        email: String(row.email || '').trim().toLowerCase() || undefined,
        phone: String(row.phone || '').trim() || undefined,
        mobile: String(row.mobile || '').trim() || undefined,
        addressLine1: String(row.addressLine1 || '').trim() || undefined,
        addressLine2: String(row.addressLine2 || '').trim() || undefined,
        city: String(row.city || '').trim() || undefined,
        state: String(row.state || '').trim() || undefined,
        postalCode: String(row.postalCode || '').trim() || undefined,
        country: String(row.country || '').trim() || undefined,
        creditLimit: toNullableNumber(row.creditLimit),
        paymentTermsDays: toNullableNumber(row.paymentTermsDays),
        status: String(row.status || '').trim().toLowerCase() || 'active',
        notes: String(row.notes || '').trim() || undefined,
        isActive: parseBoolean(row.isActive) ?? true,
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });

      try {
        // eslint-disable-next-line no-await-in-loop
        await Customer.create(payload);
        imported += 1;
      } catch (rowErr) {
        skipped += 1;
        errors.push(`Row ${rowNum}: ${rowErr.message || 'failed to import row.'}`);
      }
    }

    return res.status(200).json({
      ok: true,
      message: `Customer import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    console.error('Import customers error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to import customers.' });
  }
}

async function exportCustomers(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = {};

    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { legalName: { [Op.like]: `%${req.query.q}%` } },
        { taxId: { [Op.like]: `%${req.query.q}%` } },
        { customerCode: { [Op.like]: `%${req.query.q}%` } },
        { email: { [Op.like]: `%${req.query.q}%` } },
        { contactPerson: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const rows = await Customer.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'customerCode',
      'type',
      'name',
      'legalName',
      'taxId',
      'contactPerson',
      'email',
      'phone',
      'mobile',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'postalCode',
      'country',
      'creditLimit',
      'paymentTermsDays',
      'status',
      'isActive',
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
          csvValue(json.customerCode),
          csvValue(json.type),
          csvValue(json.name),
          csvValue(json.legalName),
          csvValue(json.taxId),
          csvValue(json.contactPerson),
          csvValue(json.email),
          csvValue(json.phone),
          csvValue(json.mobile),
          csvValue(json.addressLine1),
          csvValue(json.addressLine2),
          csvValue(json.city),
          csvValue(json.state),
          csvValue(json.postalCode),
          csvValue(json.country),
          csvValue(json.creditLimit),
          csvValue(json.paymentTermsDays),
          csvValue(json.status),
          csvValue(json.isActive),
          csvValue(json.notes),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"customers-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export customers error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to export customers.' });
  }
}

async function createCustomer(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const payload = cleanUndefined(pickCustomerPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }
    if (!payload.taxId) {
      return res.status(400).json({ ok: false, message: 'taxId is required.' });
    }

    const customer = await Customer.create(payload);
    const actorName = getActorDisplayName(req.auth?.user);
    await createOrganizationMessage({
      organizationId: customer.organizationId,
      entityType: 'customer',
      entityId: customer.id,
      title: 'New customer added',
      message: `${actorName} just created customer "${customer.name}".`,
      createdBy: req.auth?.user?.id || req.auth?.userId || null,
      metadata: {
        taxId: customer.taxId || null,
        customerCode: customer.customerCode || null,
      },
    });
    return res.status(201).json({ ok: true, data: customer });
  } catch (err) {
    console.error('Create customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create customer.' });
  }
}

async function listCustomers(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};

    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { legalName: { [Op.like]: `%${req.query.q}%` } },
        { taxId: { [Op.like]: `%${req.query.q}%` } },
        { customerCode: { [Op.like]: `%${req.query.q}%` } },
        { email: { [Op.like]: `%${req.query.q}%` } },
        { contactPerson: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Customer.findAndCountAll({
      where,
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
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
    console.error('List customers error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch customers.' });
  }
}

async function getCustomerById(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Customer not found.' });
      }
    }

    const customer = await Customer.findOne({
      where,
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });
    if (!customer) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    return res.status(200).json({ ok: true, data: customer });
  } catch (err) {
    console.error('Get customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch customer.' });
  }
}

async function updateCustomer(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Customer not found.' });
      }
    }
    const customer = await Customer.findOne({ where });
    if (!customer) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    const payload = cleanUndefined(pickCustomerPayload(req.body));
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }

    await customer.update(payload);

    const updated = await Customer.findByPk(customer.id, {
      include: [
        {
          association: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
      ],
    });

    return res.status(200).json({ ok: true, data: updated || customer });
  } catch (err) {
    console.error('Update customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update customer.' });
  }
}

async function deleteCustomer(req, res) {
  try {
    const models = getCustomerModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Customer } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Customer not found.' });
      }
    }
    const customer = await Customer.findOne({ where });
    if (!customer) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    await customer.destroy();
    return res.status(200).json({ ok: true, message: 'Customer deleted successfully.' });
  } catch (err) {
    console.error('Delete customer error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete customer.' });
  }
}

module.exports = {
  createCustomer,
  importCustomers,
  exportCustomers,
  listCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
};
