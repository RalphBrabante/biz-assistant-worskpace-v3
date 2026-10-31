const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const { getModels } = require('../sequelize');
const { sendLicenseRevokedEmail } = require('../services/email-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');
const {
  LICENSE_STATUSES,
  EXPIRING_SOON_DAYS,
  activeLicenseWhere,
  toDate,
  extendedExpiry,
  licenseValidationError,
  seatUsage,
  overlappingLicenses,
  overlapWarnings,
} = require('../services/license-service');

function getLicenseModel() {
  const models = getModels();
  if (!models || !models.License) {
    return null;
  }
  return models.License;
}

function pickLicensePayload(body = {}) {
  const organizationId =
    body.organizationId === null || body.organizationId === ''
      ? null
      : body.organizationId;
  const status = body.status === undefined ? undefined : String(body.status || '').trim().toLowerCase();
  // Blank means "no seat limit".
  const maxUsers = body.maxUsers === '' || body.maxUsers === null ? null : body.maxUsers;
  const planName = body.planName ?? body.plan;

  return {
    organizationId,
    key: body.key ?? body.licenseKey,
    planName: planName === undefined ? undefined : String(planName || '').trim(),
    status,
    startsAt: body.startsAt,
    expiresAt: body.expiresAt,
    maxUsers: maxUsers === undefined || maxUsers === null ? maxUsers : Number(maxUsers),
    isActive: body.isActive,
    notes: body.notes,
  };
}

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
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

function buildLicensesPageUrl() {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  return `${appBaseUrl.replace(/\/+$/, '')}/licenses`;
}

function sendError(res, err, fallback) {
  if (err.status) {
    return res.status(err.status).json({ ok: false, message: err.message });
  }
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ ok: false, message: 'A license with this key already exists. Generate a new key.' });
  }
  console.error(`${fallback}:`, err);
  return res.status(500).json({ ok: false, message: `${fallback}.` });
}

// An "active" license whose date has passed is stored as expired straight away, rather than waiting for the hourly job.
function settleLapsedStatus(status, expiresAt, now) {
  const expiry = toDate(expiresAt);
  return status === 'active' && expiry && expiry.getTime() < now.getTime() ? 'expired' : status;
}

async function organizationExists(models, organizationId) {
  return Boolean(await models.Organization.findByPk(organizationId, { attributes: ['id'] }));
}

async function findScopedLicense(License, req, options = {}) {
  const where = { id: req.params.id };
  if (!isPrivilegedRequest(req) && !applyOrganizationWhereScope(where, req)) {
    return null;
  }
  return License.findOne({ where, ...options });
}

async function withSeatsUsed(models, license) {
  const json = typeof license.toJSON === 'function' ? license.toJSON() : { ...license };
  const usage = await seatUsage(models, [license.organizationId]);
  json.seatsUsed = license.organizationId ? usage.get(license.organizationId) || 0 : null;
  return json;
}

async function warningsFor(models, license) {
  if (license.status !== 'active' || license.isActive === false || !license.organizationId) {
    return [];
  }
  return overlapWarnings(await overlappingLicenses(models, license));
}

async function notifyOrganizationUsersLicenseRevoked(models, license) {
  if (!models?.Organization || !models?.User || !license?.organizationId) {
    return;
  }

  const organization = await models.Organization.findByPk(license.organizationId);
  if (!organization) {
    return;
  }

  const orgUsers = await organization.getUsers({
    attributes: ['id', 'email', 'firstName', 'lastName', 'isActive'],
    through: {
      where: { isActive: true },
      attributes: ['isActive'],
    },
  });

  // Include users linked by primary organization even if they are missing organization_users records.
  const primaryUsers = await models.User.findAll({
    where: {
      organizationId: license.organizationId,
      isActive: true,
    },
    attributes: ['id', 'email', 'firstName', 'lastName', 'isActive'],
  });

  const recipients = [];
  const seenEmails = new Set();
  const candidates = [...(orgUsers || []), ...(primaryUsers || [])];
  for (const user of candidates) {
    const email = String(user?.email || '').toLowerCase().trim();
    if (!user?.isActive || !email || seenEmails.has(email)) {
      continue;
    }
    seenEmails.add(email);
    recipients.push({
      email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || email,
    });
  }

  if (recipients.length === 0) {
    console.warn('License revoked notification skipped: no active recipients found.', {
      organizationId: license.organizationId,
      licenseId: license.id,
    });
    return;
  }

  const organizationName = organization.name || organization.legalName || 'your organization';
  const licensesUrl = buildLicensesPageUrl();
  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      sendLicenseRevokedEmail({
        toEmail: recipient.email,
        toName: recipient.name,
        organizationName,
        licenseKey: license.key,
        licensesUrl,
      })
    )
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.error('License revoked email notifications had failures:', {
      organizationId: license.organizationId,
      licenseId: license.id,
      attempted: recipients.length,
      failed: failures.length,
      reasons: failures.map((result) => String(result.reason?.message || result.reason || 'unknown')),
    });
  }
}

async function createLicense(req, res) {
  try {
    const models = getModels();
    const License = models?.License;
    if (!License || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const now = new Date();
    const payload = cleanUndefined(pickLicensePayload(req.body));
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }

    payload.organizationId = String(payload.organizationId || '').trim() || null;
    if (payload.organizationId && !await organizationExists(models, payload.organizationId)) {
      return res.status(400).json({ ok: false, message: 'organizationId does not reference an existing organization.' });
    }

    if (!payload.key) {
      payload.key = randomUUID();
    }
    if (!isUuidV4(payload.key)) {
      return res.status(400).json({ ok: false, message: 'key must be a valid UUID v4.' });
    }
    if (!payload.expiresAt) {
      return res.status(400).json({ ok: false, message: 'expiresAt is required.' });
    }
    payload.status = payload.status || 'active';
    payload.startsAt = payload.startsAt || now;

    const validationError = licenseValidationError(payload);
    if (validationError) {
      return res.status(400).json({ ok: false, message: validationError });
    }

    if (payload.status === 'revoked') {
      payload.revokedAt = now;
      payload.isActive = false;
    }
    payload.status = settleLapsedStatus(payload.status, payload.expiresAt, now);

    const license = await License.create(payload);
    const warnings = await warningsFor(models, license);
    return res.status(201).json({
      ok: true,
      message: 'License created successfully.',
      data: license,
      meta: { warnings },
    });
  } catch (err) {
    return sendError(res, err, 'Unable to create license');
  }
}

function applyStatusFilter(where, status, now) {
  if (!status) {
    return null;
  }
  if (status === 'expiring') {
    Object.assign(where, activeLicenseWhere(now), {
      expiresAt: { [Op.between]: [now, new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000)] },
    });
    return null;
  }
  if (!LICENSE_STATUSES.includes(status)) {
    return `status must be one of: ${[...LICENSE_STATUSES, 'expiring'].join(', ')}.`;
  }
  where.status = status;
  return null;
}

async function licenseSummary(License, scopeWhere, now) {
  const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000);
  const [byStatus, expiringSoon] = await Promise.all([
    License.count({ where: scopeWhere, group: ['status'] }),
    License.count({
      where: { ...scopeWhere, ...activeLicenseWhere(now), expiresAt: { [Op.between]: [now, soon] } },
    }),
  ]);
  const summary = { total: 0, active: 0, expiringSoon, expired: 0, revoked: 0, suspended: 0 };
  for (const row of byStatus || []) {
    const count = Number(row.count || 0);
    summary.total += count;
    if (row.status in summary) {
      summary[row.status] = count;
    }
  }
  return summary;
}

async function listLicenses(req, res) {
  try {
    const models = getModels();
    const License = models?.License;
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const now = new Date();
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;
    const privileged = isPrivilegedRequest(req);

    // Organization scope comes first and nothing below may widen it.
    const scopeWhere = {};
    if (privileged) {
      if (req.query.unassigned === 'true') scopeWhere.organizationId = null;
      else if (req.query.organizationId) scopeWhere.organizationId = req.query.organizationId;
    } else if (!applyOrganizationWhereScope(scopeWhere, req)) {
      return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
    }

    const where = { ...scopeWhere };
    const statusError = applyStatusFilter(where, String(req.query.status || '').trim().toLowerCase(), now);
    if (statusError) {
      return res.status(400).json({ ok: false, message: statusError });
    }
    if (req.query.planName) where.planName = req.query.planName;
    if (req.query.plan) where.planName = req.query.plan;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) where.isActive = isActive;

    if (req.query.expired === 'true') {
      where.expiresAt = { [Op.lt]: now };
    }
    if (req.query.expired === 'false') {
      where.expiresAt = { [Op.gte]: now };
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      const like = { [Op.like]: `%${q}%` };
      where[Op.or] = [
        { key: like },
        { planName: like },
        { status: like },
        { '$organization.name$': like },
        { '$organization.legal_name$': like },
      ];
    }

    const { rows, count } = await License.findAndCountAll({
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
      // belongsTo cannot multiply rows, so the organization search can run in the same query.
      subQuery: false,
      order: [['createdAt', 'DESC']],
    });

    const [usage, summary] = await Promise.all([
      seatUsage(models, rows.map((row) => row.organizationId)),
      licenseSummary(License, scopeWhere, now),
    ]);
    const data = rows.map((row) => ({
      ...row.toJSON(),
      seatsUsed: row.organizationId ? usage.get(row.organizationId) || 0 : null,
    }));

    return res.status(200).json({
      ok: true,
      data,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        summary,
      },
    });
  } catch (err) {
    return sendError(res, err, 'Unable to fetch licenses');
  }
}

async function getLicenseById(req, res) {
  try {
    const models = getModels();
    const License = models?.License;
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const license = await findScopedLicense(License, req, {
      include: [{ association: 'organization', attributes: ['id', 'name', 'legalName'], required: false }],
    });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    const warnings = isPrivilegedRequest(req) ? await warningsFor(models, license) : [];
    return res.status(200).json({ ok: true, data: await withSeatsUsed(models, license), meta: { warnings } });
  } catch (err) {
    return sendError(res, err, 'Unable to fetch license');
  }
}

async function updateLicense(req, res) {
  try {
    const models = getModels();
    if (!models || !models.License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { License } = models;

    const license = await findScopedLicense(License, req);
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    const now = new Date();
    const payload = cleanUndefined(pickLicensePayload(req.body));
    if (payload.key !== undefined) {
      return res.status(400).json({ ok: false, message: 'License key is immutable and cannot be updated.' });
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    if (payload.organizationId && !await organizationExists(models, payload.organizationId)) {
      return res.status(400).json({ ok: false, message: 'organizationId does not reference an existing organization.' });
    }

    const current = license.get({ plain: true });
    const validationError = licenseValidationError({ ...current, ...payload });
    if (validationError) {
      return res.status(400).json({ ok: false, message: validationError });
    }

    const wasRevoked = current.status === 'revoked';
    const nextStatus = payload.status ?? current.status;
    const isTransitioningToRevoked = !wasRevoked && nextStatus === 'revoked';
    const isReinstated = wasRevoked && nextStatus !== 'revoked';
    if (isTransitioningToRevoked) {
      payload.revokedAt = now;
      payload.isActive = false;
    }
    // Every access check requires revokedAt to be empty, so reinstating must clear it.
    if (isReinstated) {
      payload.revokedAt = null;
      payload.isActive = true;
    }

    const nextExpiry = toDate(payload.expiresAt ?? current.expiresAt);
    const expiryChanged = payload.expiresAt !== undefined && nextExpiry.getTime() !== toDate(current.expiresAt).getTime();
    const organizationChanged = payload.organizationId !== undefined && payload.organizationId !== current.organizationId;
    if (expiryChanged || organizationChanged) {
      // A new term or a new owner starts the expiry notices over.
      payload.expiryNoticeStage = null;
      payload.expiryNoticeSentAt = null;
    }
    if (expiryChanged && nextStatus === 'expired' && nextStatus === current.status && nextExpiry.getTime() >= now.getTime()) {
      payload.status = 'active';
    }
    payload.status = settleLapsedStatus(payload.status ?? current.status, nextExpiry, now);

    await license.update(payload);

    if (isTransitioningToRevoked) {
      try {
        await notifyOrganizationUsersLicenseRevoked(models, license);
      } catch (notifyErr) {
        console.error('License revoked email notification failed:', notifyErr);
      }
    }

    return res.status(200).json({
      ok: true,
      message: isReinstated ? 'License reinstated.' : 'License updated successfully.',
      data: license,
      meta: { warnings: await warningsFor(models, license) },
    });
  } catch (err) {
    return sendError(res, err, 'Unable to update license');
  }
}

async function extendLicense(req, res) {
  try {
    const models = getModels();
    if (!models || !models.License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const license = await findScopedLicense(models.License, req);
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }
    if (license.status === 'revoked') {
      return res.status(409).json({ ok: false, message: 'This license is revoked. Reinstate it before extending it.' });
    }

    const now = new Date();
    const expiresAt = extendedExpiry(license, req.body || {}, now);
    const update = { expiresAt, expiryNoticeStage: null, expiryNoticeSentAt: null };
    // Renewing a lapsed license restores access. A suspended license stays suspended.
    if (license.status === 'expired') {
      update.status = 'active';
    }
    await license.update(update);

    return res.status(200).json({
      ok: true,
      message: `License extended to ${expiresAt.toISOString().slice(0, 10)}.`,
      data: license,
      meta: { warnings: await warningsFor(models, license) },
    });
  } catch (err) {
    return sendError(res, err, 'Unable to extend license');
  }
}

async function deleteLicense(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const license = await findScopedLicense(License, req);
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    await license.destroy();
    return res.status(200).json({ ok: true, message: 'License deleted successfully.' });
  } catch (err) {
    return sendError(res, err, 'Unable to delete license');
  }
}

async function revokeLicense(req, res) {
  try {
    const models = getModels();
    if (!models || !models.License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const license = await findScopedLicense(models.License, req);
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    if (license.status === 'revoked') {
      return res.status(200).json({ ok: true, message: 'License is already revoked.', data: license });
    }

    await license.update({
      status: 'revoked',
      isActive: false,
      revokedAt: new Date(),
    });

    try {
      await notifyOrganizationUsersLicenseRevoked(models, license);
    } catch (notifyErr) {
      console.error('License revoked email notification failed:', notifyErr);
    }

    return res.status(200).json({ ok: true, message: 'License revoked successfully.', data: license });
  } catch (err) {
    return sendError(res, err, 'Unable to revoke license');
  }
}

module.exports = {
  createLicense,
  listLicenses,
  getLicenseById,
  updateLicense,
  extendLicense,
  deleteLicense,
  revokeLicense,
};
