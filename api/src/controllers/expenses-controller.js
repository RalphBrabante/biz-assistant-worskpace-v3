const { Op } = require('sequelize');
const { parse } = require('csv-parse/sync');
const path = require('path');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const {
  compressImageAtPath,
  deleteRemoteFileByUrl,
  uploadImageFromDisk,
  StorageProviderError,
} = require('../services/storage-service');
const {
  createOrganizationMessage,
  getActorDisplayName,
} = require('../services/message-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');
const { computeExpenseAmounts, ExpenseCalculationError } = require('../services/expense-calculation');
const { isVatTaxType } = require('../services/tax-calculation');

function getExpenseModels() {
  const models = getModels();
  if (
    !models
    || !models.Expense
    || !models.Vendor
    || !models.VendorOrganization
    || !models.Organization
    || !models.OrganizationUser
    || !models.TaxType
    || !models.WithholdingTaxType
  ) {
    return null;
  }
  return {
    Expense: models.Expense,
    Vendor: models.Vendor,
    VendorOrganization: models.VendorOrganization,
    Organization: models.Organization,
    OrganizationUser: models.OrganizationUser,
    License: models.License || null,
    TaxType: models.TaxType,
    WithholdingTaxType: models.WithholdingTaxType,
  };
}

function pickExpensePayload(body = {}) {
  return {
    organizationId: body.organizationId,
    vendorId: body.vendorId,
    vendorTaxId: body.vendorTaxId,
    expenseNumber: body.expenseNumber,
    vatExemptAmount: body.vatExemptAmount,
    receiptVatAmount: body.receiptVatAmount,
    taxableAmount: body.taxableAmount,
    withHoldingTaxAmount: body.withHoldingTaxAmount,
    withholdingTaxTypeId: body.withholdingTaxTypeId,
    category: body.category,
    description: body.description,
    expenseDate: body.expenseDate,
    dueDate: body.dueDate,
    status: body.status,
    paymentMethod: body.paymentMethod,
    currency: body.currency,
    amount: body.amount,
    taxAmount: body.taxAmount,
    taxTypeId: body.taxTypeId,
    discountAmount: body.discountAmount,
    scPwdDiscount: body.scPwdDiscount,
    serviceCharge: body.serviceCharge,
    totalAmount: body.totalAmount,
    receiptUrl: body.receiptUrl,
    file: body.file,
    fileCdnUrl: body.fileCdnUrl,
    notes: body.notes,
    paidAt: body.paidAt,
    approvedBy: body.approvedBy,
    createdBy: body.createdBy,
    updatedBy: body.updatedBy,
  };
}

function isRemotePublicUrl(value) {
  const url = String(value || '').trim();
  return url.startsWith('http://') || url.startsWith('https://');
}

function collectExpenseFileUrls(expenseLike = {}) {
  const candidates = [
    String(expenseLike.fileCdnUrl || '').trim(),
    String(expenseLike.file || '').trim(),
    String(expenseLike.receiptUrl || '').trim(),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
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

function getAuthenticatedUserId(req) {
  return req.auth?.userId || req.auth?.user?.id || null;
}

function roundCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function expenseInclude(models) {
  return [
    {
      model: models.Organization,
      as: 'organization',
      attributes: ['id', 'name', 'legalName'],
      required: false,
    },
    {
      association: 'vendor',
      attributes: ['id', 'name', 'taxId', 'contactPerson', 'phone', 'contactEmail', 'addressLine1', 'addressLine2', 'barangay', 'city', 'province', 'postalCode', 'country'],
      required: false,
    },
    {
      association: 'taxType',
      attributes: ['id', 'code', 'name', 'percentage'],
      required: false,
    },
    {
      association: 'withholdingTaxType',
      attributes: ['id', 'code', 'name', 'percentage'],
      required: false,
    },
  ];
}

async function findVendorLinkedToOrganization(models, vendorId, organizationId) {
  if (!vendorId || !organizationId) {
    return null;
  }

  const directVendor = await models.Vendor.findOne({
    where: {
      id: vendorId,
      organizationId,
    },
  });
  if (directVendor) {
    return directVendor;
  }

  const linkedVendor = await models.Vendor.findOne({
    where: { id: vendorId },
    include: [
      {
        association: 'organizationLinks',
        where: { organizationId },
        required: true,
      },
    ],
  });
  return linkedVendor || null;
}

async function findVendorByTaxIdForOrganization(models, taxId, organizationId) {
  const cleanedTaxId = String(taxId || '').trim();
  if (!cleanedTaxId || !organizationId) {
    return null;
  }

  const ownedVendor = await models.Vendor.findOne({
    where: {
      organizationId,
      taxId: cleanedTaxId,
    },
  });
  if (ownedVendor) {
    return ownedVendor;
  }

  const linkedVendor = await models.Vendor.findOne({
    where: { taxId: cleanedTaxId },
    include: [
      {
        association: 'organizationLinks',
        where: { organizationId },
        required: true,
      },
    ],
  });
  return linkedVendor || null;
}

async function ensureVendorLinkedToOrganization(models, vendor, organizationId, actorId) {
  if (!vendor?.id || !organizationId || !models.VendorOrganization) {
    return;
  }

  await models.VendorOrganization.findOrCreate({
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

  const authOrgId = getAuthenticatedOrganizationId(req);
  if (authOrgId && authOrgId === organizationId) {
    return true;
  }

  return userHasActiveOrganizationMembership(models, getAuthenticatedUserId(req), organizationId);
}

async function userCanUseVendorForExpenseOrganization(models, req, vendor, expenseOrganizationId) {
  if (!vendor || !expenseOrganizationId) {
    return false;
  }

  if (vendor.organizationId === expenseOrganizationId) {
    return true;
  }

  const vendorOrganization = await models.VendorOrganization.findOne({
    where: {
      vendorId: vendor.id,
      organizationId: expenseOrganizationId,
    },
    attributes: ['id'],
  });
  if (!vendorOrganization) {
    return false;
  }

  if (isPrivilegedRequest(req)) {
    return true;
  }

  const userId = getAuthenticatedUserId(req);
  return (
    await userHasActiveOrganizationMembership(models, userId, expenseOrganizationId)
  );
}

async function listTransferTargetOrganizations(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Organization, OrganizationUser } = models;
    const excludeOrganizationId = String(req.query.excludeOrganizationId || '').trim();
    const where = {
      isActive: {
        [Op.ne]: false,
      },
    };

    if (excludeOrganizationId) {
      where.id = { [Op.ne]: excludeOrganizationId };
    }

    if (isPrivilegedRequest(req)) {
      const organizations = await Organization.findAll({
        where,
        attributes: ['id', 'name', 'legalName', 'currency'],
        order: [['name', 'ASC']],
        limit: 500,
      });

      return res.status(200).json({
        ok: true,
        data: organizations,
        meta: { total: organizations.length },
      });
    }

    const userId = req.auth?.userId || req.auth?.user?.id || null;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Authentication required.' });
    }

    const memberships = await OrganizationUser.findAll({
      where: {
        userId,
        isActive: true,
      },
      attributes: ['organizationId'],
    });
    const organizationIds = memberships
      .map((membership) => membership.organizationId)
      .filter(Boolean);

    const primaryOrganizationId = getAuthenticatedOrganizationId(req);
    if (primaryOrganizationId && !organizationIds.includes(primaryOrganizationId)) {
      organizationIds.push(primaryOrganizationId);
    }

    if (organizationIds.length === 0) {
      return res.status(200).json({ ok: true, data: [], meta: { total: 0 } });
    }

    where.id = excludeOrganizationId
      ? { [Op.in]: organizationIds, [Op.ne]: excludeOrganizationId }
      : organizationIds;

    const organizations = await Organization.findAll({
      where,
      attributes: ['id', 'name', 'legalName', 'currency'],
      order: [['name', 'ASC']],
      limit: 500,
    });

    return res.status(200).json({
      ok: true,
      data: organizations,
      meta: { total: organizations.length },
    });
  } catch (err) {
    if (err instanceof ExpenseCalculationError) return res.status(400).json({ ok: false, message: err.message });
    console.error('List expense transfer target organizations error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch transfer target organizations.' });
  }
}

async function importExpenses(req, res) {
  try {
    const models = getExpenseModels();
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

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const organizationId = resolveImportOrganizationId(req);

    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const organization = await Organization.findByPk(organizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }
    if (!organization.taxTypeId || !organization.taxType || organization.taxType.isActive === false) {
      return res.status(400).json({
        ok: false,
        message: 'Organization tax type is required and must be active before importing expenses.',
      });
    }

    const currency = await getOrganizationCurrency(organizationId);
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let index = 0; index < records.length; index += 1) {
      const row = records[index];
      const rowNum = index + 2;
      const vendorId = String(row.vendorId || '').trim();
      const category = String(row.category || '').trim();
      const expenseDate = String(row.expenseDate || '').trim();

      if (!vendorId || !category || !expenseDate) {
        skipped += 1;
        errors.push(`Row ${rowNum}: vendorId, category and expenseDate are required.`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const vendor = await Vendor.findOne({
        where: {
          id: vendorId,
        },
      });

      // eslint-disable-next-line no-await-in-loop
      const canUseVendor = vendor
        ? await userCanUseVendorForExpenseOrganization(models, req, vendor, organizationId)
        : false;
      if (!vendor || !canUseVendor) {
        skipped += 1;
        errors.push(`Row ${rowNum}: vendorId is not assigned to the target organization.`);
        continue;
      }

      const rawWithholdingTaxTypeId = String(row.withholdingTaxTypeId || '').trim();
      const rawWithholdingTaxTypeCode = String(row.withholdingTaxTypeCode || '').trim();
      const payload = cleanUndefined({
        organizationId,
        vendorId,
        vendorTaxId: String(row.vendorTaxId || vendor.taxId || '').trim() || undefined,
        vatExemptAmount: row.vatExemptAmount || 0,
        receiptVatAmount: row.receiptVatAmount || undefined,
        serviceCharge: row.serviceCharge || 0,
        category,
        description: String(row.description || '').trim() || undefined,
        expenseDate,
        dueDate: String(row.dueDate || '').trim() || undefined,
        status: String(row.status || '').trim() || 'draft',
        paymentMethod: String(row.paymentMethod || '').trim() || 'bank_transfer',
        currency,
        amount: row.amount || 0,
        taxTypeId: organization.taxTypeId,
        withholdingTaxTypeId: rawWithholdingTaxTypeId || undefined,
        discountAmount: row.discountAmount || 0,
        notes: String(row.notes || '').trim() || undefined,
        createdBy: req.auth?.user?.id || null,
        updatedBy: req.auth?.user?.id || null,
      });

      let withholdingTaxPercentage = 0;
      let withholdingMinimumBase = 0;
      if (payload.withholdingTaxTypeId || rawWithholdingTaxTypeCode) {
        // eslint-disable-next-line no-await-in-loop
        const withholdingTaxType = await WithholdingTaxType.findOne({
          where: { appliesTo: { [Op.in]: ['expense', 'both'] },
            organizationId,
            ...(payload.withholdingTaxTypeId
              ? { id: payload.withholdingTaxTypeId }
              : { code: rawWithholdingTaxTypeCode.toUpperCase() }),
            isActive: true,
          },
        });
        if (!withholdingTaxType) {
          skipped += 1;
          errors.push(`Row ${rowNum}: withholdingTaxTypeId/withholdingTaxTypeCode is invalid.`);
          continue;
        }
        payload.withholdingTaxTypeId = withholdingTaxType.id;
        withholdingTaxPercentage = Number(withholdingTaxType.percentage || 0);
        withholdingMinimumBase = withholdingTaxType.minimumBaseAmount || 0;
      }

      try {
        Object.assign(payload, computeExpenseAmounts({
          amount: payload.amount,
          vatExemptAmount: payload.vatExemptAmount,
          receiptVatAmount: payload.receiptVatAmount,
          serviceCharge: payload.serviceCharge,
          discountAmount: payload.discountAmount,
          taxType: organization.taxType,
          withholdingPercentage: withholdingTaxPercentage,
          withholdingMinimumBaseAmount: withholdingMinimumBase,
        }));
      } catch (err) {
        if (!(err instanceof ExpenseCalculationError)) throw err;
        skipped += 1;
        errors.push(`Row ${rowNum}: ${err.message}`);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await Expense.create(payload);
      imported += 1;
    }

    return res.status(200).json({
      ok: true,
      message: `Expense import complete. Imported ${imported}, skipped ${skipped}.`,
      data: {
        imported,
        skipped,
        totalRows: records.length,
        errors,
      },
    });
  } catch (err) {
    if (err instanceof ExpenseCalculationError) return res.status(400).json({ ok: false, message: err.message });
    console.error('Import expenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to import expenses.' });
  }
}

async function resolveUploadedExpenseFile(req) {
  if (!req.file || !req.file.filename) {
    return null;
  }

  const localPath = String(req.file.path || '').trim();
  if (localPath) {
    await compressImageAtPath(localPath, 2 * 1024 * 1024);
    const uploadedUrl = await uploadImageFromDisk(localPath, {
      targetKey: 'expense_attachment',
      folder: 'expenses',
      fileName: req.file.filename,
      contentType: req.file.mimetype || undefined,
    });
    if (uploadedUrl) {
      return {
        file: uploadedUrl,
        fileCdnUrl: isRemotePublicUrl(uploadedUrl) ? uploadedUrl : null,
      };
    }
  }
  return {
    file: `/uploads/expenses/${path.basename(req.file.filename)}`,
    fileCdnUrl: null,
  };
}

async function getExpenseTaxContext(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    const organizationId = req.query.organizationId || getAuthenticatedOrganizationId(req);
    if (!organizationId) return res.status(400).json({ ok: false, message: 'Select an organization first.' });
    if (!await userCanAccessOrganization(models, req, organizationId)) return res.status(403).json({ ok: false, message: 'You do not have access to this organization.' });
    const organization = await models.Organization.findByPk(organizationId, {
      attributes: ['id', 'currency'],
      include: [{ association: 'taxType', attributes: ['id', 'code', 'name', 'percentage', 'isActive'] }],
    });
    if (!organization?.taxType || !organization.taxType.isActive) return res.status(400).json({ ok: false, message: 'Set an active organization tax type before recording expenses.' });
    const withholdingTaxTypes = await models.WithholdingTaxType.findAll({
      where: { organizationId, isActive: true, appliesTo: { [Op.in]: ['expense', 'both'] } },
      attributes: ['id', 'code', 'name', 'percentage', 'minimumBaseAmount'], order: [['name', 'ASC']],
    });
    return res.json({ ok: true, data: { organization, withholdingTaxTypes } });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Unable to load expense tax settings.' });
  }
}

async function createExpense(req, res, next) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const payload = cleanUndefined(pickExpensePayload(req.body));
    const uploadedFile = await resolveUploadedExpenseFile(req);
    if (uploadedFile) {
      payload.file = uploadedFile.file;
      payload.fileCdnUrl = uploadedFile.fileCdnUrl;
    }
    if (!isPrivilegedRequest(req)) {
      const requestedOrganizationId = String(payload.organizationId || '').trim();
      payload.organizationId = requestedOrganizationId || getAuthenticatedOrganizationId(req);
    }

    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }
    if (!await userCanAccessOrganization(models, req, payload.organizationId)) {
      return res.status(403).json({ ok: false, message: 'You do not have access to this organization.' });
    }
    if (!payload.vendorId) {
      return res.status(400).json({ ok: false, message: 'vendorId is required.' });
    }
    if (!payload.category) {
      return res.status(400).json({ ok: false, message: 'category is required.' });
    }
    if (!payload.expenseDate) {
      return res.status(400).json({ ok: false, message: 'expenseDate is required.' });
    }
    if (payload.amount === undefined || payload.amount === null || payload.amount === '') {
      return res.status(400).json({ ok: false, message: 'amount is required.' });
    }
    payload.amount = Number(payload.amount);
    if (!Number.isFinite(payload.amount) || payload.amount < 0) {
      return res.status(400).json({ ok: false, message: 'amount must be a non-negative number.' });
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
        message: 'Organization tax type is required and must be active before creating expenses.',
      });
    }
    payload.taxTypeId = organization.taxTypeId;

    let withholdingTaxPercentage = 0;
    let withholdingMinimumBase = 0;
    if (payload.withholdingTaxTypeId) {
      const withholdingTaxType = await WithholdingTaxType.findOne({
        where: { appliesTo: { [Op.in]: ['expense', 'both'] },
          id: payload.withholdingTaxTypeId,
          organizationId: payload.organizationId,
          isActive: true,
        },
      });
      if (!withholdingTaxType) {
        return res.status(400).json({ ok: false, message: 'withholdingTaxTypeId is invalid.' });
      }
      withholdingTaxPercentage = Number(withholdingTaxType.percentage || 0);
      withholdingMinimumBase = withholdingTaxType.minimumBaseAmount || 0;
    }

    Object.assign(
      payload,
      computeExpenseAmounts({
        amount: payload.amount,
        vatExemptAmount: payload.vatExemptAmount,
        receiptVatAmount: payload.receiptVatAmount,
        serviceCharge: payload.serviceCharge,
        discountAmount: payload.discountAmount,
        taxType: organization.taxType,
        withholdingPercentage: withholdingTaxPercentage,
        withholdingMinimumBaseAmount: withholdingMinimumBase,
      })
    );

    const vendor = await Vendor.findOne({
      where: {
        id: payload.vendorId,
      },
    });
    if (!vendor || !await userCanUseVendorForExpenseOrganization(models, req, vendor, payload.organizationId)) {
      return res.status(400).json({
        ok: false,
        message: 'Selected vendor is invalid for this organization.',
      });
    }
    if (!payload.vendorTaxId && vendor.taxId) {
      payload.vendorTaxId = vendor.taxId;
    }

    const expense = await Expense.create(payload);
    const actorName = getActorDisplayName(req.auth?.user);
    await createOrganizationMessage({
      organizationId: expense.organizationId,
      entityType: 'expense',
      entityId: expense.id,
      title: 'New expense added',
      message: `${actorName} just created expense "${expense.category}".`,
      createdBy: req.auth?.user?.id || req.auth?.userId || null,
      metadata: {
        amount: expense.amount || 0,
        currency: expense.currency || null,
        vendorId: expense.vendorId || null,
      },
    });
    const created = await Expense.findByPk(expense.id, {
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId', 'contactPerson', 'phone', 'contactEmail', 'addressLine1', 'addressLine2', 'barangay', 'city', 'province', 'postalCode', 'country'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
    });

    return res.status(201).json({ ok: true, data: created || expense });
  } catch (err) {
    if (err instanceof ExpenseCalculationError) return res.status(400).json({ ok: false, message: err.message });
    if (err instanceof StorageProviderError) {
      const providerMessage = String(err.message || '').trim();
      return res.status(502).json({
        code: err.code || 'STORAGE_UPLOAD_ERROR',
        message: providerMessage || 'Unable to upload expense attachment to cloud storage.',
        data: {
          details: err.details || null,
        },
      });
    }
    return next(err);
  }
}

async function listExpenses(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Organization } = models;
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
    if (req.query.vendorId) where.vendorId = req.query.vendorId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod;
    if (req.query.vatExemptAmount) where.vatExemptAmount = req.query.vatExemptAmount;
    if (req.query.expenseDateFrom || req.query.expenseDateTo) {
      where.expenseDate = {};
      if (req.query.expenseDateFrom) {
        where.expenseDate[Op.gte] = req.query.expenseDateFrom;
      }
      if (req.query.expenseDateTo) {
        where.expenseDate[Op.lte] = req.query.expenseDateTo;
      }
    }

    if (req.query.q) {
      where[Op.or] = [
        { expenseNumber: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
        { description: { [Op.like]: `%${req.query.q}%` } },
        { vendorTaxId: { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.legal_name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.tax_id$': { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Expense.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId', 'contactPerson', 'phone', 'contactEmail', 'addressLine1', 'addressLine2', 'barangay', 'city', 'province', 'postalCode', 'country'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
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
    console.error('List expenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch expenses.' });
  }
}

async function exportExpenses(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const where = {};
    if (req.query.organizationId) where.organizationId = req.query.organizationId;
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
    }
    if (req.query.vendorId) where.vendorId = req.query.vendorId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod;
    if (req.query.vatExemptAmount) where.vatExemptAmount = req.query.vatExemptAmount;
    if (req.query.expenseDateFrom || req.query.expenseDateTo) {
      where.expenseDate = {};
      if (req.query.expenseDateFrom) {
        where.expenseDate[Op.gte] = req.query.expenseDateFrom;
      }
      if (req.query.expenseDateTo) {
        where.expenseDate[Op.lte] = req.query.expenseDateTo;
      }
    }

    if (req.query.q) {
      where[Op.or] = [
        { expenseNumber: { [Op.like]: `%${req.query.q}%` } },
        { category: { [Op.like]: `%${req.query.q}%` } },
        { description: { [Op.like]: `%${req.query.q}%` } },
        { vendorTaxId: { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.legal_name$': { [Op.like]: `%${req.query.q}%` } },
        { '$vendor.tax_id$': { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const rows = await Expense.findAll({
      where,
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId', 'contactPerson', 'phone', 'contactEmail', 'addressLine1', 'addressLine2', 'barangay', 'city', 'province', 'postalCode', 'country'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: 10000,
    });

    const headers = [
      'id',
      'organizationId',
      'vendorId',
      'vendorName',
      'vendorTaxId',
      'category',
      'description',
      'expenseDate',
      'dueDate',
      'status',
      'paymentMethod',
      'currency',
      'amount',
      'taxAmount',
      'taxTypeId',
      'taxTypeCode',
      'taxTypeName',
      'withholdingTaxTypeId',
      'withholdingTaxTypeCode',
      'withholdingTaxTypeName',
      'discountAmount',
      'vatExemptAmount',
      'receiptVatAmount',
      'withholdingTaxBase',
      'serviceCharge',
      'taxableAmount',
      'withHoldingTaxAmount',
      'totalAmount',
      'notes',
      'file',
      'fileCdnUrl',
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
          csvValue(json.vendorId),
          csvValue(json.vendor?.name),
          csvValue(json.vendorTaxId),
          csvValue(json.category),
          csvValue(json.description),
          csvValue(json.expenseDate),
          csvValue(json.dueDate),
          csvValue(json.status),
          csvValue(json.paymentMethod),
          csvValue(json.currency),
          csvValue(json.amount),
          csvValue(json.taxAmount),
          csvValue(json.taxTypeId),
          csvValue(json.taxType?.code),
          csvValue(json.taxType?.name),
          csvValue(json.withholdingTaxTypeId),
          csvValue(json.withholdingTaxType?.code),
          csvValue(json.withholdingTaxType?.name),
          csvValue(json.discountAmount),
          csvValue(json.vatExemptAmount),
          csvValue(json.receiptVatAmount),
          csvValue(json.withholdingTaxBase),
          csvValue(json.serviceCharge),
          csvValue(json.taxableAmount),
          csvValue(json.withHoldingTaxAmount),
          csvValue(json.totalAmount),
          csvValue(json.notes),
          csvValue(json.file),
          csvValue(json.fileCdnUrl),
          csvValue(json.createdAt),
          csvValue(json.updatedAt),
        ].join(',')
      );
    }

    const csv = lines.join('\n');
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"expenses-${date}.csv\"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Export expenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to export expenses.' });
  }
}

async function getExpenseById(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }

    const expense = await Expense.findOne({
      where,
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId', 'contactPerson', 'phone', 'contactEmail', 'addressLine1', 'addressLine2', 'barangay', 'city', 'province', 'postalCode', 'country'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
    });
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    return res.status(200).json({ ok: true, data: expense });
  } catch (err) {
    console.error('Get expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch expense.' });
  }
}

async function transferExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const targetOrganizationId = String(req.body?.organizationId || req.body?.targetOrganizationId || '').trim();
    if (!targetOrganizationId) {
      return res.status(400).json({ ok: false, message: 'target organizationId is required.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }

    const expense = await Expense.findOne({
      where, include: [{ association: 'taxType', attributes: ['code', 'name', 'percentage'], required: false }],
    });
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    if (expense.organizationId === targetOrganizationId) {
      return res.status(400).json({ ok: false, message: 'Expense is already in the target organization.' });
    }

    const userId = req.auth?.userId || req.auth?.user?.id || null;
    if (!isPrivilegedRequest(req)) {
      const hasTargetMembership = await userHasActiveOrganizationMembership(
        models,
        userId,
        targetOrganizationId
      );
      if (!hasTargetMembership) {
        return res.status(403).json({
          ok: false,
          message: 'You must be an active member of the target organization to transfer this expense.',
        });
      }
    }

    const targetOrganization = await Organization.findByPk(targetOrganizationId, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage', 'isActive'],
          required: false,
        },
      ],
    });
    if (
      !targetOrganization
      || targetOrganization.isActive === false
      || !targetOrganization.taxTypeId
      || !targetOrganization.taxType
      || targetOrganization.taxType.isActive === false
    ) {
      return res.status(400).json({
        ok: false,
        message: 'Target organization tax type is required and must be active before transferring expenses.',
      });
    }

    if (expense.expenseNumber) {
      const duplicate = await Expense.findOne({
        where: {
          organizationId: targetOrganizationId,
          expenseNumber: expense.expenseNumber,
          id: { [Op.ne]: expense.id },
        },
        attributes: ['id'],
      });
      if (duplicate) {
        return res.status(409).json({
          ok: false,
          message: 'Target organization already has an expense with this expense number.',
        });
      }
    }

    const payload = {
      organizationId: targetOrganizationId,
      currency: await getOrganizationCurrency(targetOrganizationId),
      taxTypeId: targetOrganization.taxTypeId,
      updatedBy: userId,
    };

    const requestedVendorId = String(req.body?.vendorId || '').trim();
    const requestedVendorTaxId = String(req.body?.vendorTaxId || '').trim();
    if (requestedVendorId) {
      const vendor = await findVendorLinkedToOrganization(models, requestedVendorId, targetOrganizationId);
      if (!vendor) {
        return res.status(400).json({ ok: false, message: 'Selected vendor is invalid for the target organization.' });
      }
      payload.vendorId = vendor.id;
      payload.vendorTaxId = requestedVendorTaxId || vendor.taxId || expense.vendorTaxId || null;
    } else {
      let resolvedVendor = null;
      if (expense.vendorId) {
        resolvedVendor = await findVendorLinkedToOrganization(models, expense.vendorId, targetOrganizationId);
        if (!resolvedVendor) {
          const sourceVendor = await Vendor.findByPk(expense.vendorId);
          if (sourceVendor) {
            const sourceTaxId = sourceVendor.taxId || expense.vendorTaxId;
            resolvedVendor = await findVendorByTaxIdForOrganization(models, sourceTaxId, targetOrganizationId);
            if (!resolvedVendor) {
              await ensureVendorLinkedToOrganization(models, sourceVendor, targetOrganizationId, userId);
              resolvedVendor = sourceVendor;
            }
          }
        }
      }
      if (!resolvedVendor && expense.vendorTaxId) {
        resolvedVendor = await findVendorByTaxIdForOrganization(models, expense.vendorTaxId, targetOrganizationId);
      }
      if (resolvedVendor) {
        payload.vendorId = resolvedVendor.id;
        payload.vendorTaxId = resolvedVendor.taxId || expense.vendorTaxId || null;
      } else {
        payload.vendorId = null;
        payload.vendorTaxId = requestedVendorTaxId || expense.vendorTaxId || null;
      }
    }

    let withholdingTaxPercentage = 0;
    let withholdingMinimumBase = 0;
    const requestedWithholdingTaxTypeId = String(req.body?.withholdingTaxTypeId || '').trim();
    if (requestedWithholdingTaxTypeId) {
      const withholdingTaxType = await WithholdingTaxType.findOne({
        where: { appliesTo: { [Op.in]: ['expense', 'both'] },
          id: requestedWithholdingTaxTypeId,
          organizationId: targetOrganizationId,
          isActive: true,
        },
      });
      if (!withholdingTaxType) {
        return res.status(400).json({ ok: false, message: 'withholdingTaxTypeId is invalid for the target organization.' });
      }
      payload.withholdingTaxTypeId = withholdingTaxType.id;
      withholdingTaxPercentage = Number(withholdingTaxType.percentage || 0);
      withholdingMinimumBase = withholdingTaxType.minimumBaseAmount || 0;
    } else if (expense.withholdingTaxTypeId) {
      const existingWithholdingInTarget = await WithholdingTaxType.findOne({
        where: { appliesTo: { [Op.in]: ['expense', 'both'] },
          id: expense.withholdingTaxTypeId,
          organizationId: targetOrganizationId,
          isActive: true,
        },
      });
      payload.withholdingTaxTypeId = existingWithholdingInTarget ? expense.withholdingTaxTypeId : null;
      withholdingTaxPercentage = Number(existingWithholdingInTarget?.percentage || 0);
      withholdingMinimumBase = existingWithholdingInTarget?.minimumBaseAmount || 0;
    }

    Object.assign(
      payload,
      computeExpenseAmounts({
        amount: expense.amount,
        vatExemptAmount: expense.vatExemptAmount,
        // Legacy PT amounts are not supplier VAT. Preserve only a recorded VAT split.
        receiptVatAmount: expense.receiptVatAmount ?? (isVatTaxType(expense.taxType) ? expense.taxAmount : 0),
        serviceCharge: expense.serviceCharge,
        discountAmount: expense.discountAmount,
        taxType: targetOrganization.taxType,
        withholdingPercentage: withholdingTaxPercentage,
        withholdingMinimumBaseAmount: withholdingMinimumBase,
      })
    );

    const previousOrganizationId = expense.organizationId;
    await expense.update(payload);

    const actorName = getActorDisplayName(req.auth?.user);
    await createOrganizationMessage({
      organizationId: targetOrganizationId,
      entityType: 'expense',
      entityId: expense.id,
      title: 'Expense transferred',
      message: `${actorName} transferred expense "${expense.category}" into this organization.`,
      createdBy: userId,
      metadata: {
        previousOrganizationId,
        amount: expense.amount || 0,
        currency: payload.currency || null,
      },
    });

    const updated = await Expense.findByPk(expense.id, {
      include: expenseInclude(models),
    });

    return res.status(200).json({
      ok: true,
      message: 'Expense transferred successfully.',
      data: updated || expense,
    });
  } catch (err) {
    if (err instanceof ExpenseCalculationError) return res.status(400).json({ ok: false, message: err.message });
    console.error('Transfer expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to transfer expense.' });
  }
}

async function updateExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense, Vendor, Organization, WithholdingTaxType } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }
    const expense = await Expense.findOne({ where });
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    const payload = cleanUndefined(pickExpensePayload(req.body));
    const previousFiles = collectExpenseFileUrls(expense);
    const uploadedFile = await resolveUploadedExpenseFile(req);
    if (uploadedFile) {
      payload.file = uploadedFile.file;
      payload.fileCdnUrl = uploadedFile.fileCdnUrl;
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    if (payload.organizationId && payload.organizationId !== expense.organizationId) {
      return res.status(400).json({ ok: false, message: 'Use Transfer Expense to change the organization.' });
    }
    const effectiveOrganizationId = expense.organizationId;
    const effectiveAmount = payload.amount ?? expense.amount;
    if (effectiveAmount === undefined || effectiveAmount === null || effectiveAmount === '') {
      return res.status(400).json({ ok: false, message: 'amount is required.' });
    }
    if (!Number.isFinite(Number(effectiveAmount)) || Number(effectiveAmount) < 0) {
      return res.status(400).json({ ok: false, message: 'amount must be a non-negative number.' });
    }
    payload.currency = await getOrganizationCurrency(effectiveOrganizationId);
    const organization = await Organization.findByPk(effectiveOrganizationId, {
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
        message: 'Organization tax type is required and must be active before updating expenses.',
      });
    }
    payload.taxTypeId = organization.taxTypeId;

    let withholdingTaxPercentage = 0;
    let withholdingMinimumBase = 0;
    const withholdingId = Object.prototype.hasOwnProperty.call(payload, 'withholdingTaxTypeId')
      ? String(payload.withholdingTaxTypeId || '').trim()
      : String(expense.withholdingTaxTypeId || '').trim();
    payload.withholdingTaxTypeId = withholdingId || null;
    if (withholdingId) {
      const withholdingType = await WithholdingTaxType.findOne({
        where: { appliesTo: { [Op.in]: ['expense', 'both'] }, id: withholdingId, organizationId: effectiveOrganizationId, isActive: true },
      });
      if (!withholdingType) return res.status(400).json({ ok: false, message: 'Selected withholding tax type is unavailable. Select an active type or None.' });
      withholdingTaxPercentage = withholdingType.percentage;
      withholdingMinimumBase = withholdingType.minimumBaseAmount || 0;
    }

    const computed = computeExpenseAmounts({
      amount: payload.amount ?? expense.amount,
      vatExemptAmount: payload.vatExemptAmount ?? expense.vatExemptAmount,
      receiptVatAmount: Object.prototype.hasOwnProperty.call(payload, 'receiptVatAmount') ? payload.receiptVatAmount : expense.receiptVatAmount,
      serviceCharge: payload.serviceCharge ?? expense.serviceCharge,
      discountAmount: payload.discountAmount ?? expense.discountAmount,
      taxType: organization.taxType,
      withholdingPercentage: withholdingTaxPercentage,
      withholdingMinimumBaseAmount: withholdingMinimumBase,
    });
    Object.assign(payload, computed);

    if (payload.vendorId) {
      const organizationId = payload.organizationId || expense.organizationId;
      const vendor = await Vendor.findOne({
        where: {
          id: payload.vendorId,
        },
      });
      if (!vendor || !await userCanUseVendorForExpenseOrganization(models, req, vendor, organizationId)) {
        return res.status(400).json({
          ok: false,
          message: 'Selected vendor is invalid for this organization.',
        });
      }
      if (!payload.vendorTaxId && vendor.taxId) {
        payload.vendorTaxId = vendor.taxId;
      }
    }

    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }

    await expense.update(payload);
    if (payload.file) {
      const currentFiles = collectExpenseFileUrls(payload);
      const filesToDelete = previousFiles.filter((url) => !currentFiles.includes(url));
      for (const fileUrl of filesToDelete) {
        try {
          // Best-effort cleanup; keep update successful even if remote deletion fails.
          // eslint-disable-next-line no-await-in-loop
          await deleteRemoteFileByUrl(fileUrl);
        } catch (_err) {
          // Best-effort cleanup; keep update successful even if remote deletion fails.
        }
      }
    }
    const updated = await Expense.findByPk(expense.id, {
      include: [
        {
          association: 'vendor',
          attributes: ['id', 'name', 'taxId', 'contactPerson', 'phone', 'contactEmail', 'addressLine1', 'addressLine2', 'barangay', 'city', 'province', 'postalCode', 'country'],
          required: false,
        },
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
        {
          association: 'withholdingTaxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
    });

    return res.status(200).json({ ok: true, data: updated || expense });
  } catch (err) {
    if (err instanceof ExpenseCalculationError) return res.status(400).json({ ok: false, message: err.message });
    if (err instanceof StorageProviderError) {
      return res.status(502).json({
        code: err.code || 'STORAGE_UPLOAD_ERROR',
        message: err.message || 'Unable to upload expense attachment to cloud storage.',
      });
    }
    console.error('Update expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update expense.' });
  }
}

async function deleteExpense(req, res) {
  try {
    const models = getExpenseModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Expense } = models;
    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'Expense not found.' });
      }
    }
    const expense = await Expense.findOne({ where });
    if (!expense) {
      return res.status(404).json({ ok: false, message: 'Expense not found.' });
    }

    const fileUrls = collectExpenseFileUrls(expense);
    await expense.destroy();
    for (const fileUrl of fileUrls) {
      try {
        // Best-effort cleanup after delete.
        // eslint-disable-next-line no-await-in-loop
        await deleteRemoteFileByUrl(fileUrl);
      } catch (_err) {
        // Best-effort cleanup after delete.
      }
    }
    return res.status(200).json({ ok: true, message: 'Expense deleted successfully.' });
  } catch (err) {
    console.error('Delete expense error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete expense.' });
  }
}

module.exports = {
  getExpenseTaxContext,
  createExpense,
  importExpenses,
  exportExpenses,
  listTransferTargetOrganizations,
  listExpenses,
  getExpenseById,
  transferExpense,
  updateExpense,
  deleteExpense,
};
