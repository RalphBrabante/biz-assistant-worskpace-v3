const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { sendOrganizationUserInviteEmail } = require('../services/email-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  assertOrganizationAccess,
} = require('../services/request-scope');

function getOrganizationModel() {
  const models = getModels();
  if (!models || !models.Organization || !models.TaxType) {
    return null;
  }
  return {
    Organization: models.Organization,
    TaxType: models.TaxType,
  };
}

function getOrganizationMembershipModels() {
  const models = getModels();
  if (!models || !models.Organization || !models.User || !models.OrganizationUser) {
    return null;
  }
  return {
    Organization: models.Organization,
    User: models.User,
    OrganizationUser: models.OrganizationUser,
    Role: models.Role || null,
    UserRole: models.UserRole || null,
    Token: models.Token || null,
  };
}

function pickOrganizationPayload(body = {}) {
  return {
    name: body.name,
    legalName: body.legalName,
    taxId: body.taxId,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    postalCode: body.postalCode,
    country: body.country,
    currency: body.currency,
    taxTypeId: body.taxTypeId,
    taxpayerClassification: body.taxpayerClassification,
    deductionMethod: body.deductionMethod,
    incomeTaxRate: body.incomeTaxRate,
    isIncomeTaxExempt: body.isIncomeTaxExempt,
    contactEmail: body.contactEmail,
    phone: body.phone,
    website: body.website,
    contactName: body.contactName,
    industry: body.industry,
    employeeCount: body.employeeCount,
    notes: body.notes,
    isActive: body.isActive,
  };
}

function normalizeTaxpayerProfile(payload = {}) {
  const allowedClassifications = new Set([
    'individual',
    'corporation',
    'partnership',
    'estate_trust',
    'non_stock_non_profit',
    'other',
  ]);
  const allowedDeductionMethods = new Set(['itemized', 'osd', 'none']);

  if (payload.taxpayerClassification !== undefined) {
    const value = String(payload.taxpayerClassification || '').trim().toLowerCase();
    payload.taxpayerClassification = value && allowedClassifications.has(value) ? value : null;
  }

  if (payload.deductionMethod !== undefined) {
    const value = String(payload.deductionMethod || '').trim().toLowerCase();
    payload.deductionMethod = allowedDeductionMethods.has(value) ? value : 'itemized';
  }

  if (payload.incomeTaxRate !== undefined) {
    const rate = payload.incomeTaxRate === null || payload.incomeTaxRate === ''
      ? null
      : Number(payload.incomeTaxRate);
    payload.incomeTaxRate = Number.isFinite(rate) && rate >= 0 ? rate : null;
  }

  if (payload.isIncomeTaxExempt !== undefined) {
    payload.isIncomeTaxExempt = Boolean(payload.isIncomeTaxExempt);
  }
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

function isRequesterSuperuser(req) {
  const roleCodes = req.auth?.roleCodes || [];
  return roleCodes.some((code) => String(code || '').toLowerCase() === 'superuser');
}

function buildSetPasswordUrl(rawToken) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  const resetPath = String(process.env.RESET_PASSWORD_PATH || '/reset-password').trim();
  const safePath = resetPath.startsWith('/') ? resetPath : `/${resetPath}`;
  const separator = safePath.includes('?') ? '&' : '?';
  return `${appBaseUrl.replace(/\/+$/, '')}${safePath}${separator}token=${encodeURIComponent(
    rawToken
  )}`;
}

function sanitizeUser(user) {
  const json = user.toJSON ? user.toJSON() : user;
  delete json.password;
  return json;
}

async function setPrimaryOrganizationMembership(models, userId, organizationId) {
  if (!models?.OrganizationUser || !models?.User || !userId || !organizationId) {
    return;
  }

  await models.OrganizationUser.update(
    { isPrimary: false },
    {
      where: {
        userId,
        isPrimary: true,
      },
    }
  );

  await models.OrganizationUser.update(
    { isPrimary: true, isActive: true },
    {
      where: {
        userId,
        organizationId,
      },
    }
  );

  await models.User.update(
    { organizationId },
    {
      where: {
        id: userId,
      },
    }
  );
}

async function createOrganization(req, res) {
  try {
    const orgModels = getOrganizationModel();
    if (!orgModels) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Organization, TaxType } = orgModels;

    const payload = cleanUndefined(pickOrganizationPayload(req.body));
    normalizeTaxpayerProfile(payload);

    if (!payload.name) {
      return res.status(400).json({ ok: false, message: 'name is required.' });
    }
    if (!payload.addressLine1) {
      return res.status(400).json({ ok: false, message: 'addressLine1 is required.' });
    }
    if (!payload.city) {
      return res.status(400).json({ ok: false, message: 'city is required.' });
    }
    if (!payload.country) {
      payload.country = 'United States';
    }
    payload.currency = String(payload.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
    if (!payload.taxTypeId) {
      return res.status(400).json({ ok: false, message: 'taxTypeId is required.' });
    }
    const taxType = await TaxType.findOne({
      where: {
        id: payload.taxTypeId,
        isActive: true,
      },
    });
    if (!taxType) {
      return res.status(400).json({ ok: false, message: 'taxTypeId is invalid.' });
    }
    if (!payload.contactEmail) {
      return res.status(400).json({ ok: false, message: 'contactEmail is required.' });
    }
    if (!payload.phone) {
      return res.status(400).json({ ok: false, message: 'phone is required.' });
    }

    const organization = await Organization.create(payload);
    const created = await Organization.findByPk(organization.id, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
    });
    return res.status(201).json({ ok: true, data: created || organization });
  } catch (err) {
    console.error('Create organization error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create organization.' });
  }
}

async function listOrganizations(req, res) {
  try {
    const orgModels = getOrganizationModel();
    if (!orgModels) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Organization } = orgModels;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (!isPrivilegedRequest(req)) {
      const organizationId = getAuthenticatedOrganizationId(req);
      if (!organizationId) {
        return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
      }
      where.id = organizationId;
    }
    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (req.query.q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.query.q}%` } },
        { legalName: { [Op.like]: `%${req.query.q}%` } },
        { taxId: { [Op.like]: `%${req.query.q}%` } },
        { contactEmail: { [Op.like]: `%${req.query.q}%` } },
        { city: { [Op.like]: `%${req.query.q}%` } },
        { state: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await Organization.findAndCountAll({
      where,
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
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
    console.error('List organizations error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch organizations.' });
  }
}

async function getOrganizationById(req, res) {
  try {
    const orgModels = getOrganizationModel();
    if (!orgModels) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Organization } = orgModels;

    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
    });
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    return res.status(200).json({ ok: true, data: organization });
  } catch (err) {
    console.error('Get organization error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch organization.' });
  }
}

async function listOrganizationUsers(req, res) {
  try {
    const models = getOrganizationMembershipModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Organization, User } = models;
    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const users = await organization.getUsers({
      joinTableAttributes: ['id', 'role', 'isActive', 'isPrimary', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: users.map((user) => sanitizeUser(user)),
      meta: {
        total: users.length,
      },
    });
  } catch (err) {
    console.error('List organization users error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch organization users.' });
  }
}

async function searchAssignableUsers(req, res) {
  try {
    const models = getOrganizationMembershipModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Organization, User, OrganizationUser } = models;
    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);

    const memberships = await OrganizationUser.findAll({
      where: { organizationId: organization.id },
      attributes: ['userId'],
    });
    const existingUserIds = memberships.map((row) => row.userId);

    const where = {};
    if (existingUserIds.length > 0) {
      where.id = { [Op.notIn]: existingUserIds };
    }

    if (q) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${q}%` } },
        { lastName: { [Op.like]: `%${q}%` } },
        { email: { [Op.like]: `%${q}%` } },
      ];
    }

    const users = await User.findAll({
      where,
      limit,
      order: [['createdAt', 'DESC']],
    });

    return res.status(200).json({
      ok: true,
      data: users.map((user) => sanitizeUser(user)),
      meta: {
        total: users.length,
      },
    });
  } catch (err) {
    console.error('Search assignable users error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to search assignable users.' });
  }
}

async function listOrganizationAssignableRoles(req, res) {
  try {
    const models = getOrganizationMembershipModels();
    if (!models || !models.Role) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Organization, Role } = models;
    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }
    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const roles = await Role.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'code', 'description'],
      order: [['name', 'ASC']],
    });

    return res.status(200).json({
      ok: true,
      data: roles,
      meta: { total: roles.length },
    });
  } catch (err) {
    console.error('List organization assignable roles error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch assignable roles.' });
  }
}

async function addUserToOrganization(req, res) {
  try {
    const models = getOrganizationMembershipModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Organization, User, OrganizationUser, Role, UserRole, Token } = models;
    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ ok: false, message: 'userId is required.' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const requestedRoleId = String(req.body?.roleId || '').trim();
    const requestedRole = String(req.body?.role || 'member').trim() || 'member';
    let resolvedRoleCode = requestedRole;
    let resolvedRoleId = null;

    if (
      String(requestedRole || '').toLowerCase() === 'superuser' &&
      !isRequesterSuperuser(req)
    ) {
      return res.status(403).json({
        ok: false,
        message: 'Only superusers can assign the SUPERUSER role.',
      });
    }

    if (requestedRoleId && Role) {
      const roleRecord = await Role.findByPk(requestedRoleId);
      if (!roleRecord) {
        return res.status(404).json({ ok: false, message: 'Role not found.' });
      }
      if (
        String(roleRecord.code || '').toLowerCase() === 'superuser' &&
        !isRequesterSuperuser(req)
      ) {
        return res.status(403).json({
          ok: false,
          message: 'Only superusers can assign the SUPERUSER role.',
        });
      }
      resolvedRoleCode = String(roleRecord.code || requestedRole).trim() || 'member';
      resolvedRoleId = roleRecord.id;
    }

    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    const requestedIsPrimary = parseBoolean(req.body?.isPrimary);
    const hasExistingPrimary = await OrganizationUser.count({
      where: {
        userId,
        isPrimary: true,
      },
    });
    const shouldSetPrimary = requestedIsPrimary === true || hasExistingPrimary === 0;

    const [membership, created] = await OrganizationUser.findOrCreate({
      where: {
        organizationId: organization.id,
        userId,
      },
      defaults: {
        organizationId: organization.id,
        userId,
        role: resolvedRoleCode,
        isActive,
        isPrimary: shouldSetPrimary,
      },
    });

    if (!created) {
      const nextMembershipPayload = { role: resolvedRoleCode, isActive };
      if (requestedIsPrimary !== undefined) {
        nextMembershipPayload.isPrimary = requestedIsPrimary;
      }
      await membership.update(nextMembershipPayload);
    }

    if (shouldSetPrimary || requestedIsPrimary === true) {
      await setPrimaryOrganizationMembership(models, userId, organization.id);
      await membership.reload();
    }

    if (resolvedRoleId && UserRole) {
      const [userRole] = await UserRole.findOrCreate({
        where: {
          userId,
          roleId: resolvedRoleId,
        },
        defaults: {
          userId,
          roleId: resolvedRoleId,
          assignedByUserId: req.auth?.userId || null,
          isActive: true,
        },
      });

      if (!userRole.isActive) {
        await userRole.update({
          isActive: true,
          assignedByUserId: req.auth?.userId || null,
        });
      }

      if (user.role !== resolvedRoleCode) {
        await user.update({ role: resolvedRoleCode });
      }
    }

    const sendInviteFlag = parseBoolean(req.body?.sendInvite);
    const shouldSendInvite = sendInviteFlag === undefined ? created : sendInviteFlag;
    let inviteEmail = null;

    if (shouldSendInvite && user.email && Token) {
      const normalizedEmail = String(user.email).toLowerCase().trim();
      const expiresInMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
      const rawToken = crypto.randomBytes(48).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await Token.update(
        {
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'superseded_organization_invite',
        },
        {
          where: {
            userId: user.id,
            type: 'reset_password',
            isActive: true,
            revokedAt: null,
          },
        }
      );

      await Token.create({
        userId: user.id,
        tokenHash,
        type: 'reset_password',
        scope: 'organization_invite',
        expiresAt,
        ipAddress: req.ip || null,
        userAgent: req.get('user-agent') || null,
        metadata: {
          email: normalizedEmail,
          organizationId: organization.id,
          organizationName: organization.name,
          invitedByUserId: req.auth?.userId || null,
        },
        isActive: true,
      });

      const setPasswordUrl = buildSetPasswordUrl(rawToken);
      try {
        await sendOrganizationUserInviteEmail({
          toEmail: normalizedEmail,
          toName:
            [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
            normalizedEmail,
          organizationName: organization.name || organization.legalName || 'your organization',
          setPasswordUrl,
          expiresInMinutes,
        });
        inviteEmail = { sent: true };
      } catch (emailErr) {
        console.error('Organization invite email error:', emailErr);
        inviteEmail = {
          sent: false,
          message: 'Membership added, but invite email was not sent.',
        };
      }
    }

    return res.status(created ? 201 : 200).json({
      ok: true,
      message: created ? 'User added to organization.' : 'Organization membership updated.',
      data: {
        id: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        role: membership.role,
        roleId: resolvedRoleId,
        isActive: membership.isActive,
        isPrimary: membership.isPrimary,
        inviteEmail,
      },
    });
  } catch (err) {
    console.error('Add user to organization error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to add user to organization.' });
  }
}

async function removeUserFromOrganization(req, res) {
  try {
    const models = getOrganizationMembershipModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const { Organization, User, OrganizationUser } = models;
    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const user = await User.findByPk(req.params.userId);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const membership = await OrganizationUser.findOne({
      where: {
        organizationId: organization.id,
        userId: user.id,
      },
    });
    if (!membership) {
      return res.status(404).json({ ok: false, message: 'User is not a member of this organization.' });
    }

    const wasPrimary = Boolean(membership.isPrimary);
    const deletedCount = await OrganizationUser.destroy({
      where: {
        organizationId: organization.id,
        userId: user.id,
      },
    });

    if (wasPrimary) {
      const nextPrimary = await OrganizationUser.findOne({
        where: {
          userId: user.id,
          isActive: true,
        },
        order: [['createdAt', 'ASC']],
      });
      if (nextPrimary?.organizationId) {
        await setPrimaryOrganizationMembership(models, user.id, nextPrimary.organizationId);
      } else {
        await User.update({ organizationId: null }, { where: { id: user.id } });
      }
    }

    return res.status(200).json({ ok: true, message: 'User removed from organization.' });
  } catch (err) {
    console.error('Remove user from organization error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove user from organization.' });
  }
}

async function updateOrganization(req, res) {
  try {
    const orgModels = getOrganizationModel();
    if (!orgModels) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Organization, TaxType } = orgModels;

    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const payload = cleanUndefined(pickOrganizationPayload(req.body));
    normalizeTaxpayerProfile(payload);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }
    if (payload.currency !== undefined) {
      payload.currency = String(payload.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
    }
    const resolvedTaxTypeId = payload.taxTypeId || organization.taxTypeId;
    if (!resolvedTaxTypeId) {
      return res.status(400).json({ ok: false, message: 'taxTypeId is required.' });
    }
    const taxType = await TaxType.findOne({
      where: {
        id: resolvedTaxTypeId,
        isActive: true,
      },
    });
    if (!taxType) {
      return res.status(400).json({ ok: false, message: 'taxTypeId is invalid.' });
    }

    await organization.update(payload);
    const updated = await Organization.findByPk(organization.id, {
      include: [
        {
          association: 'taxType',
          attributes: ['id', 'code', 'name', 'percentage'],
          required: false,
        },
      ],
    });
    return res.status(200).json({ ok: true, data: updated || organization });
  } catch (err) {
    console.error('Update organization error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update organization.' });
  }
}

async function deleteOrganization(req, res) {
  try {
    const orgModels = getOrganizationModel();
    if (!orgModels) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { Organization } = orgModels;

    if (!assertOrganizationAccess(req, req.params.id)) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    const organization = await Organization.findByPk(req.params.id);
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found.' });
    }

    await organization.destroy();
    return res.status(200).json({ ok: true, message: 'Organization deleted successfully.' });
  } catch (err) {
    console.error('Delete organization error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete organization.' });
  }
}

module.exports = {
  createOrganization,
  listOrganizations,
  getOrganizationById,
  listOrganizationUsers,
  searchAssignableUsers,
  listOrganizationAssignableRoles,
  addUserToOrganization,
  removeUserFromOrganization,
  updateOrganization,
  deleteOrganization,
};
