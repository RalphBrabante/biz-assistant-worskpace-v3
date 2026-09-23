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
const {
  isPercentageTaxType,
  isVatTaxType,
} = require('../services/tax-calculation');

function getSalesInvoiceModel() {
  const models = getModels();
  if (!models || !models.SalesInvoice) {
    return null;
  }
  return models.SalesInvoice;
}

function pickSalesInvoicePayload(body = {}) {
  return {
    organizationId: body.organizationId,
    orderId: body.orderId,
    invoiceNumber: body.invoiceNumber,
    issueDate: body.issueDate,
    dueDate: body.dueDate,
    status: body.status,
    paymentStatus: body.paymentStatus,
    currency: body.currency,
    amount: body.amount,
    taxableAmount: body.taxableAmount,
    withHoldingTaxAmount: body.withHoldingTaxAmount,
    withholdingTaxTypeId: body.withholdingTaxTypeId,
    subtotalAmount: body.subtotalAmount,
    taxAmount: body.taxAmount,
    discountAmount: body.discountAmount,
    scPwdDiscount: body.scPwdDiscount,
    serviceCharge: body.serviceCharge,
    totalAmount: body.totalAmount,
    paidAt: body.paidAt,
    notes: body.notes,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function cleanUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return false;
}

function normalizeHeaderKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function roundCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function normalizeInvoiceTotals(payload = {}, taxType = {}, withholdingTaxType = null) {
  // Normalize invoice math in one place so create/import use the same rules.
  const grossAmount = roundCurrency(
    payload.subtotalAmount !== undefined ? payload.subtotalAmount : payload.amount
  );
  const discountAmount = roundCurrency(payload.discountAmount);
  const scPwdDiscount = roundCurrency(payload.scPwdDiscount);
  const serviceCharge = roundCurrency(payload.serviceCharge);
  const requestedWithholding = roundCurrency(payload.withHoldingTaxAmount);
  const vatRate = isVatTaxType(taxType) ? Number(taxType.percentage || 0) / 100 : 0;
  const subtotalAmount = vatRate > 0
    ? roundCurrency(grossAmount / (1 + vatRate))
    : grossAmount;
  const taxableAmount = vatRate > 0
    ? roundCurrency(Math.max(subtotalAmount - discountAmount - scPwdDiscount, 0))
    : roundCurrency(Math.max(grossAmount - discountAmount - scPwdDiscount + serviceCharge, 0));
  const taxAmount = vatRate > 0 ? roundCurrency(taxableAmount * vatRate) : 0;
  const withholdingRate = withholdingTaxType ? Number(withholdingTaxType.percentage || 0) / 100 : 0;
  const withHoldingTaxAmount = withholdingRate > 0
    ? roundCurrency(taxableAmount * withholdingRate)
    : requestedWithholding;

  payload.amount = grossAmount;
  payload.subtotalAmount = subtotalAmount;
  payload.taxAmount = taxAmount;
  payload.taxableAmount = taxableAmount;
  payload.withHoldingTaxAmount = withHoldingTaxAmount;
  payload.discountAmount = discountAmount;
  payload.scPwdDiscount = scPwdDiscount;
  payload.serviceCharge = serviceCharge;

  payload.totalAmount = vatRate > 0
    ? roundCurrency(Math.max(taxableAmount + taxAmount + serviceCharge - withHoldingTaxAmount, 0))
    : roundCurrency(Math.max(taxableAmount - withHoldingTaxAmount, 0));
  if (isPercentageTaxType(taxType)) {
    payload.taxAmount = 0;
  }
}

async function resolveInvoiceWithholdingTaxType(models, organizationId, withholdingTaxTypeId) {
  const requestedId = String(withholdingTaxTypeId || '').trim();
  if (!requestedId) {
    return null;
  }
  if (!models?.WithholdingTaxType) {
    return null;
  }
  return models.WithholdingTaxType.findOne({
    where: {
      id: requestedId,
      organizationId,
      isActive: true,
      appliesTo: {
        [Op.in]: ['invoice', 'both'],
      },
    },
  });
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

function resolveSortOptions(query = {}) {
  // Whitelist sort fields to avoid invalid/unsafe ORDER BY input.
  const allowedSortFields = new Set([
    'createdAt',
    'updatedAt',
    'invoiceNumber',
    'issueDate',
    'dueDate',
    'status',
    'paymentStatus',
    'amount',
    'taxableAmount',
    'totalAmount',
  ]);
  const requestedField = String(query.sortBy || 'createdAt').trim();
  const sortBy = allowedSortFields.has(requestedField) ? requestedField : 'createdAt';
  const requestedDirection = String(query.sortDirection || 'DESC').trim().toUpperCase();
  const sortDirection = requestedDirection === 'ASC' ? 'ASC' : 'DESC';
  return { sortBy, sortDirection };
}

function resolveImportOrganizationId(req) {
  if (!isPrivilegedRequest(req)) {
    return getAuthenticatedOrganizationId(req);
  }
  return req.body?.organizationId || req.query?.organizationId || getAuthenticatedOrganizationId(req);
}

async function importSalesInvoices(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Organization || !models.WithholdingTaxType) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Organization, WithholdingTaxType } = models;
    const Order = models.Order || null;

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
    const forceImport = parseBoolean(req.body?.forceImport || req.query?.forceImport);

    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const currency = await getOrganizationCurrency(organizationId);
    const organization = await Organization.findByPk(organizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
      return res.status(400).json({
        ok: false,
        message: 'Organization tax type is required and must be active before importing sales invoices.',
      });
    }
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      // Import runs row-by-row to return precise per-line errors.
      const row = records[index];
      const rowNum = index + 2;
      const rowMap = new Map(
        Object.entries(row || {}).map(([key, value]) => [normalizeHeaderKey(key), value])
      );
      const cell = (...aliases) => {
        for (const alias of aliases) {
          const value = rowMap.get(normalizeHeaderKey(alias));
          if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
          }
        }
        return '';
      };
      const numberCell = (...aliases) => {
        const value = cell(...aliases);
        return toNullableNumber(value);
      };

      const orderId = cell('orderId', 'order_id', 'order id');
      const invoiceNumber = cell('invoiceNumber', 'invoice_number', 'invoice no', 'invoice_no');
      const issueDate = cell('issueDate', 'issue_date', 'invoiceDate', 'invoice_date');
      const withholdingTaxTypeId = cell('withholdingTaxTypeId', 'withholding_tax_type_id');
      const withholdingTaxTypeCode = cell('withholdingTaxTypeCode', 'withholding_tax_type_code', 'ewtCode', 'ewt_code');

      if (!invoiceNumber || !issueDate) {
        skipped += 1;
        errors.push(`Row ${rowNum}: invoiceNumber and issueDate are required.`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const duplicateByInvoice = await SalesInvoice.findOne({
        where: {
          organizationId,
          invoiceNumber,
        },
      });
      // eslint-disable-next-line no-await-in-loop
      const duplicateByOrder = orderId
        ? await SalesInvoice.findOne({
            where: {
              organizationId,
              orderId,
            },
          })
        : null;

      const payload = cleanUndefined({
        organizationId,
        orderId: orderId || undefined,
        invoiceNumber,
        issueDate,
        dueDate: cell('dueDate', 'due_date') || undefined,
        status: cell('status') || 'draft',
        paymentStatus: cell('paymentStatus', 'payment_status') || 'unpaid',
        currency,
        amount: numberCell('amount'),
        taxableAmount: numberCell('taxableAmount', 'taxable_amount'),
        withHoldingTaxAmount: numberCell('withHoldingTaxAmount', 'with_holding_tax_amount', 'withholding_tax_amount'),
        withholdingTaxTypeId: withholdingTaxTypeId || undefined,
        subtotalAmount: numberCell('subtotalAmount', 'subtotal_amount'),
        taxAmount: numberCell('taxAmount', 'tax_amount'),
        discountAmount: numberCell('discountAmount', 'discount_amount'),
        totalAmount: numberCell('totalAmount', 'total_amount'),
        paidAt: cell('paidAt', 'paid_at') || undefined,
        notes: cell('notes') || undefined,
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });
      let withholdingTaxType = null;
      if (withholdingTaxTypeId || withholdingTaxTypeCode) {
        // eslint-disable-next-line no-await-in-loop
        withholdingTaxType = await WithholdingTaxType.findOne({
          where: {
            organizationId,
            isActive: true,
            appliesTo: { [Op.in]: ['invoice', 'both'] },
            ...(withholdingTaxTypeId
              ? { id: withholdingTaxTypeId }
              : { code: withholdingTaxTypeCode.toUpperCase() }),
          },
        });
        if (!withholdingTaxType) {
          skipped += 1;
          errors.push(`Row ${rowNum}: withholdingTaxTypeId/withholdingTaxTypeCode is invalid for sales invoices.`);
          continue;
        }
        payload.withholdingTaxTypeId = withholdingTaxType.id;
      }
      normalizeInvoiceTotals(payload, organization.taxType, withholdingTaxType);

      try {
        if (Order && orderId) {
          // eslint-disable-next-line no-await-in-loop
          const order = await Order.findOne({
            where: {
              id: orderId,
              organizationId,
            },
          });
          if (!order) {
            skipped += 1;
            errors.push(`Row ${rowNum}: orderId does not exist for this organization.`);
            continue;
          }
        }

        if (duplicateByInvoice || duplicateByOrder) {
          if (!forceImport) {
            skipped += 1;
            if (duplicateByInvoice && duplicateByOrder && duplicateByInvoice.id === duplicateByOrder.id) {
              errors.push(`Row ${rowNum}: invoiceNumber and orderId already exist (enable Force Import to overwrite by invoice number).`);
            } else if (duplicateByInvoice) {
              errors.push(`Row ${rowNum}: invoiceNumber already exists (enable Force Import to overwrite by invoice number).`);
            } else {
              errors.push(`Row ${rowNum}: orderId already has a sales invoice. Use a different orderId.`);
            }
            continue;
          }

          // Force import intentionally overwrites by invoice number only.
          // We avoid overwriting by order linkage to protect order/invoice history.
          if (!duplicateByInvoice) {
            skipped += 1;
            errors.push(`Row ${rowNum}: cannot force overwrite by orderId. Force Import only overwrites by invoiceNumber.`);
            continue;
          }

          // Avoid cross-record collisions where invoice number belongs to one row and order to another.
          if (duplicateByOrder && duplicateByOrder.id !== duplicateByInvoice.id) {
            skipped += 1;
            errors.push(`Row ${rowNum}: invoiceNumber and orderId belong to different existing invoices. Resolve conflict manually.`);
            continue;
          }

          const target = duplicateByInvoice;
          const updatePayload = {
            ...payload,
            // Do not override order linkage during force import.
            orderId: target.orderId,
            createdBy: target.createdBy || payload.createdBy,
            updatedBy: req.auth?.user?.id || target.updatedBy || null,
          };
          // eslint-disable-next-line no-await-in-loop
          await target.update(updatePayload);
          updated += 1;
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await SalesInvoice.create(payload);
        imported += 1;
      } catch (rowErr) {
        skipped += 1;
        errors.push(`Row ${rowNum}: ${rowErr.message || 'failed to import row.'}`);
      }
    }

    return res.status(200).json({
      ok: true,
      message: `Sales invoice import complete. Imported ${imported}, updated ${updated}, skipped ${skipped}.`,
      data: {
        imported,
        updated,
        skipped,
        forceImport,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    console.error('Import sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to import sales invoices.' });
  }
}

async function createSalesInvoice(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Organization } = models;

    const payload = cleanUndefined(pickSalesInvoicePayload(req.body));
    const actorId = req.auth?.userId || req.auth?.user?.id || null;
    payload.createdBy = actorId;
    payload.updatedBy = actorId;
    payload.withholdingTaxTypeId = String(payload.withholdingTaxTypeId || '').trim() || null;
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!payload.invoiceNumber) {
      return res.status(400).json({ ok: false, message: 'invoiceNumber is required.' });
    }
    if (!payload.issueDate) {
      return res.status(400).json({ ok: false, message: 'issueDate is required.' });
    }
    // The order foreign key verifies existence, not organization ownership.
    // Standalone invoices remain supported; linked orders must share the scope.
    if (payload.orderId !== undefined && payload.orderId !== null) {
      payload.orderId = String(payload.orderId).trim() || null;
    }
    if (payload.orderId) {
      if (!models.Order) {
        return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
      }
      const order = await models.Order.findOne({
        where: { id: payload.orderId, organizationId: payload.organizationId },
        attributes: ['id', 'workflow'],
      });
      if (!order) {
        return res.status(400).json({ ok: false, message: 'orderId must belong to the invoice organization.' });
      }
      if (order.workflow) return res.status(400).json({ ok: false, message: 'Issue invoices from this order’s workspace.' });
    }
    payload.currency = await getOrganizationCurrency(payload.organizationId);
    const organization = await Organization.findByPk(payload.organizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (!organization || !organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
      return res.status(400).json({
        ok: false,
        message: 'Organization tax type is required and must be active before creating sales invoices.',
      });
    }
    const withholdingTaxType = await resolveInvoiceWithholdingTaxType(
      models,
      payload.organizationId,
      payload.withholdingTaxTypeId
    );
    if (payload.withholdingTaxTypeId && !withholdingTaxType) {
      return res.status(400).json({
        ok: false,
        message: 'withholdingTaxTypeId is invalid for sales invoices.',
      });
    }
    normalizeInvoiceTotals(payload, organization.taxType, withholdingTaxType);

    const salesInvoice = await SalesInvoice.create(payload);
    const actorName = getActorDisplayName(req.auth?.user);
    await createOrganizationMessage({
      organizationId: salesInvoice.organizationId,
      entityType: 'sales_invoice',
      entityId: salesInvoice.id,
      title: 'New sales invoice added',
      message: `${actorName} just created sales invoice "${salesInvoice.invoiceNumber}".`,
      createdBy: req.auth?.user?.id || req.auth?.userId || null,
      metadata: {
        orderId: salesInvoice.orderId || null,
        totalAmount: salesInvoice.totalAmount || 0,
        currency: salesInvoice.currency || null,
      },
    });
    return res.status(201).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Create sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create sales invoice.' });
  }
}

async function listSalesInvoices(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Organization, Order, Customer, WithholdingTaxType } = models;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 10000);
    const offset = (page - 1) * limit;
    const { sortBy, sortDirection } = resolveSortOptions(req.query);

    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.orderId) where.orderId = req.query.orderId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
    if (req.query.issueDateFrom || req.query.issueDateTo) {
      where.issueDate = {};
      if (req.query.issueDateFrom) {
        where.issueDate[Op.gte] = req.query.issueDateFrom;
      }
      if (req.query.issueDateTo) {
        where.issueDate[Op.lte] = req.query.issueDateTo;
      }
    }

    if (req.query.q) {
      where[Op.or] = [
        { invoiceNumber: { [Op.like]: `%${req.query.q}%` } },
        { status: { [Op.like]: `%${req.query.q}%` } },
        { paymentStatus: { [Op.like]: `%${req.query.q}%` } },
        { orderId: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await SalesInvoice.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          include: [
            {
              association: 'taxType',
              attributes: ['id', 'code', 'name', 'percentage'],
              required: false,
            },
          ],
          required: false,
        },
        ...(Order && Customer ? [{
          model: Order,
          as: 'order',
          attributes: ['id', 'customerId'],
          required: false,
          include: [{
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'contactPerson', 'email', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'],
            required: false,
          }],
        }] : []),
        ...(WithholdingTaxType ? [{
          model: WithholdingTaxType,
          as: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage', 'appliesTo'],
          required: false,
        }] : []),
      ],
      limit,
      offset,
      order: [
        [sortBy, sortDirection],
        // A unique final key stabilizes paging when import timestamps are equal.
        ...(sortBy === 'createdAt' ? [] : [['createdAt', 'DESC']]),
        ['id', 'DESC'],
      ],
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
    console.error('List sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch sales invoices.' });
  }
}

async function exportSalesInvoices(req, res) {
  try {
    const models = getModels();
    const SalesInvoice = models?.SalesInvoice;
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const WithholdingTaxType = models.WithholdingTaxType || null;

    const where = {};
    const { sortBy, sortDirection } = resolveSortOptions(req.query);
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.orderId) where.orderId = req.query.orderId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
    if (req.query.issueDateFrom || req.query.issueDateTo) {
      where.issueDate = {};
      if (req.query.issueDateFrom) {
        where.issueDate[Op.gte] = req.query.issueDateFrom;
      }
      if (req.query.issueDateTo) {
        where.issueDate[Op.lte] = req.query.issueDateTo;
      }
    }

    if (req.query.q) {
      where[Op.or] = [
        { invoiceNumber: { [Op.like]: `%${req.query.q}%` } },
        { status: { [Op.like]: `%${req.query.q}%` } },
        { paymentStatus: { [Op.like]: `%${req.query.q}%` } },
        { orderId: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const rows = await SalesInvoice.findAll({
      where,
      include: WithholdingTaxType ? [{
        model: WithholdingTaxType,
        as: 'withholdingTaxType',
        attributes: ['id', 'code', 'name', 'percentage'],
        required: false,
      }] : [],
      order: [
        [sortBy, sortDirection],
        ...(sortBy === 'createdAt' ? [] : [['createdAt', 'DESC']]),
        ['id', 'DESC'],
      ],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'orderId',
      'invoiceNumber',
      'issueDate',
      'dueDate',
      'status',
      'paymentStatus',
      'currency',
      'amount',
      'taxableAmount',
      'withHoldingTaxAmount',
      'withholdingTaxTypeId',
      'withholdingTaxTypeCode',
      'withholdingTaxTypeName',
      'subtotalAmount',
      'taxAmount',
      'discountAmount',
      'totalAmount',
      'paidAt',
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
          csvValue(json.orderId),
          csvValue(json.invoiceNumber),
          csvValue(json.issueDate),
          csvValue(json.dueDate),
          csvValue(json.status),
          csvValue(json.paymentStatus),
          csvValue(json.currency),
          csvValue(json.amount),
          csvValue(json.taxableAmount),
          csvValue(json.withHoldingTaxAmount),
          csvValue(json.withholdingTaxTypeId),
          csvValue(json.withholdingTaxType?.code),
          csvValue(json.withholdingTaxType?.name),
          csvValue(json.subtotalAmount),
          csvValue(json.taxAmount),
          csvValue(json.discountAmount),
          csvValue(json.totalAmount),
          csvValue(json.paidAt),
          csvValue(json.notes),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"sales-invoices-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export sales invoices error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to export sales invoices.' });
  }
}

async function getSalesInvoiceById(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Order || !models.OrderItemSnapshot || !models.Customer) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { SalesInvoice, Order, OrderItemSnapshot, Customer, WithholdingTaxType } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
      }
    }

    const salesInvoice = await SalesInvoice.findOne({
      where,
      include: [
        {
          model: Order,
          as: 'order',
          include: [
            {
              model: Customer,
              as: 'customer',
              attributes: ['id', 'name', 'taxId'],
            },
            {
              model: OrderItemSnapshot,
              as: 'orderedItemSnapshots',
            },
          ],
        },
        ...(WithholdingTaxType ? [{
          model: WithholdingTaxType,
          as: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage', 'appliesTo'],
          required: false,
        }] : []),
      ],
    });
    if (!salesInvoice) {
      return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
    }

    return res.status(200).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Get sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch sales invoice.' });
  }
}

async function updateSalesInvoice(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
      }
    }

    const salesInvoice = await SalesInvoice.findOne({ where });
    if (!salesInvoice) {
      return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
    }
    if (salesInvoice.orderId && (await getModels().Order.findByPk(salesInvoice.orderId))?.workflow) return res.status(400).json({ ok: false, message: 'Manage this invoice from its order workspace.' });
    if (String(salesInvoice.status || '').toLowerCase() === 'paid') {
      return res.status(400).json({
        ok: false,
        message: 'Paid invoices are locked and can no longer be edited.',
      });
    }

    const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!requestedStatus) {
      return res.status(400).json({
        ok: false,
        message: 'Only status can be updated and status is required.',
      });
    }

    const normalizedStatus = requestedStatus === 'cancelled' ? 'void' : requestedStatus;
    const allowedStatus = new Set([
      'draft',
      'issued',
      'sent',
      'paid',
      'partially_paid',
      'overdue',
      'void',
    ]);
    if (!allowedStatus.has(normalizedStatus)) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid status value for sales invoice.',
      });
    }

    const payload = {
      status: normalizedStatus,
      updatedBy: req.auth?.user?.id || salesInvoice.updatedBy || null,
    };
    if (normalizedStatus === 'paid') {
      payload.paymentStatus = 'paid';
      payload.paidAt = salesInvoice.paidAt || new Date();
    }

    await salesInvoice.update(payload);
    return res.status(200).json({ ok: true, data: salesInvoice });
  } catch (err) {
    console.error('Update sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update sales invoice.' });
  }
}

async function deleteSalesInvoice(req, res) {
  try {
    const SalesInvoice = getSalesInvoiceModel();
    if (!SalesInvoice) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
      }
    }

    const salesInvoice = await SalesInvoice.findOne({ where });
    if (!salesInvoice) {
      return res.status(404).json({ ok: false, message: 'Sales invoice not found.' });
    }

    if (salesInvoice.orderId && (await getModels().Order.findByPk(salesInvoice.orderId))?.workflow) return res.status(400).json({ ok: false, message: 'Manage this invoice from its order workspace.' });
    await salesInvoice.destroy();
    return res.status(200).json({ ok: true, message: 'Sales invoice deleted successfully.' });
  } catch (err) {
    console.error('Delete sales invoice error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete sales invoice.' });
  }
}

module.exports = {
  createSalesInvoice,
  importSalesInvoices,
  exportSalesInvoices,
  listSalesInvoices,
  getSalesInvoiceById,
  updateSalesInvoice,
  deleteSalesInvoice,
};
