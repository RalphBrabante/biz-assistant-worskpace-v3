const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const { getModels } = require('../sequelize');
const { sendLicenseRevokedEmail } = require('../services/email-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

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

  return {
    organizationId,
    key: body.key ?? body.licenseKey,
    planName: body.planName ?? body.plan,
    status: body.status,
    startsAt: body.startsAt,
    expiresAt: body.expiresAt,
    revokedAt: body.revokedAt,
    maxUsers: body.maxUsers,
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
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const payload = cleanUndefined(pickLicensePayload(req.body));
    if (!isPrivilegedRequest(req)) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
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

    const license = await License.create(payload);
    return res.status(201).json({ ok: true, data: license });
  } catch (err) {
    console.error('Create license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create license.' });
  }
}

async function listLicenses(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

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
    if (req.query.unassigned === 'true') where.organizationId = null;
    if (req.query.planName) where.planName = req.query.planName;
    if (req.query.plan) where.planName = req.query.plan;
    if (req.query.status) where.status = req.query.status;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) where.isActive = isActive;

    if (req.query.expired === 'true') {
      where.expiresAt = { [Op.lt]: new Date() };
    }
    if (req.query.expired === 'false') {
      where.expiresAt = { [Op.gte]: new Date() };
    }

    if (req.query.q) {
      where[Op.or] = [
        { key: { [Op.like]: `%${req.query.q}%` } },
        { planName: { [Op.like]: `%${req.query.q}%` } },
        { status: { [Op.like]: `%${req.query.q}%` } },
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
    console.error('List licenses error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch licenses.' });
  }
}

async function getLicenseById(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }

    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    return res.status(200).json({ ok: true, data: license });
  } catch (err) {
    console.error('Get license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch license.' });
  }
}

async function updateLicense(req, res) {
  try {
    const models = getModels();
    if (!models || !models.License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { License } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }
    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    const payload = cleanUndefined(pickLicensePayload(req.body));
    if (payload.key !== undefined) {
      return res.status(400).json({ ok: false, message: 'License key is immutable and cannot be updated.' });
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    const isTransitioningToRevoked =
      String(license.status || '').toLowerCase() !== 'revoked' &&
      String(payload.status || '').toLowerCase() === 'revoked';
    if (isTransitioningToRevoked) {
      payload.revokedAt = payload.revokedAt || new Date();
      payload.isActive = false;
    }

    await license.update(payload);

    if (isTransitioningToRevoked) {
      try {
        await notifyOrganizationUsersLicenseRevoked(models, license);
      } catch (notifyErr) {
        console.error('License revoked email notification failed:', notifyErr);
      }
    }

    return res.status(200).json({ ok: true, data: license });
  } catch (err) {
    console.error('Update license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update license.' });
  }
}

async function deleteLicense(req, res) {
  try {
    const License = getLicenseModel();
    if (!License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }
    const license = await License.findOne({ where });
    if (!license) {
      return res.status(404).json({ ok: false, message: 'License not found.' });
    }

    await license.destroy();
    return res.status(200).json({ ok: true, message: 'License deleted successfully.' });
  } catch (err) {
    console.error('Delete license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete license.' });
  }
}

async function revokeLicense(req, res) {
  try {
    const models = getModels();
    if (!models || !models.License) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { License } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'License not found.' });
      }
    }
    const license = await License.findOne({ where });
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
    console.error('Revoke license error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to revoke license.' });
  }
}

module.exports = {
  createLicense,
  listLicenses,
  getLicenseById,
  updateLicense,
  deleteLicense,
  revokeLicense,
};
