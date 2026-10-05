const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { fail } = require('../services/debt-amounts');
const { ORGANIZATION_PRESET_ROLES } = require('../services/accountant-access');
const { getSocketServer } = require('../services/socket-service');
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
    OrganizationUserRole: models.OrganizationUserRole || null,
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
    rdoCode: body.rdoCode,
    taxpayerSize: body.taxpayerSize,
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

function normalizeTaxRegistration(payload) {
  if (payload.rdoCode !== undefined) {
    const code = String(payload.rdoCode ?? '').trim();
    if (code && !/^\d{3}$/.test(code)) return 'RDO code must contain exactly three digits.';
    payload.rdoCode = code || null;
  }
  if (payload.taxpayerSize !== undefined) {
    const size = String(payload.taxpayerSize ?? '').trim().toLowerCase();
    if (size && !['micro', 'small', 'medium', 'large'].includes(size)) {
      return 'Business size must be Micro, Small, Medium, or Large.';
    }
    payload.taxpayerSize = size || null;
  }
  return null;
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

async function setPrimaryOrganizationMembership(models, userId, organizationId, transaction) {
  if (!models?.OrganizationUser || !models?.User || !userId || !organizationId) {
    return;
  }

  await models.OrganizationUser.update(
    { isPrimary: false },
    {
      transaction,
      where: {
        userId,
        isPrimary: true,
      },
    }
  );

  await models.OrganizationUser.update(
    { isPrimary: true, isActive: true },
    {
      transaction,
      where: {
        userId,
        organizationId,
      },
    }
  );

  await models.User.update(
    { organizationId },
    {
      transaction,
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
    const registrationError = normalizeTaxRegistration(payload);
    if (registrationError) return res.status(400).json({ ok: false, message: registrationError });

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
      payload.country = 'Philippines';
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
      where: { isActive: true, code: { [Op.in]: ORGANIZATION_PRESET_ROLES } },
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
  return inviteOrganizationUser(req, res);
}

async function removeUserFromOrganization(req, res) {
  try {
    const models = getOrganizationMembershipModels();
    if (!models) return res.status(503).json({ok:false,message:'Database models are not ready yet.'});
    const {Organization, User, OrganizationUser, Token, OrganizationUserRole} = models;
    if (!assertOrganizationAccess(req, req.params.id)) return res.status(404).json({ok:false,message:'Organization not found.'});
    const organization = await Organization.findByPk(req.params.id);
    if (!organization) return res.status(404).json({ok:false,message:'Organization not found.'});

    // Remove membership, fallback access and token scope together. A concurrent
    // session must not regain access through a stale primary organization.
    await User.sequelize.transaction(async transaction => {
      const user = await User.findByPk(req.params.userId, {transaction,lock:transaction.LOCK.UPDATE});
      if (!user) throw fail(404, 'User not found.');
      const where = {organizationId:organization.id,userId:user.id};
      const membership = await OrganizationUser.findOne({where,transaction});
      if (!membership) throw fail(404, 'User is not a member of this organization.');
      await OrganizationUser.destroy({where,transaction});
      if (OrganizationUserRole) await OrganizationUserRole.destroy({where,transaction});
      if (Token) {
        const tokens = await Token.findAll({where:{userId:user.id,type:'access',isActive:true},transaction});
        for (const token of tokens) {
          if (token.metadata?.organizationId === organization.id || (!token.metadata?.organizationId && user.organizationId === organization.id)) {
            await token.update({isActive:false,revokedAt:new Date(),revokedReason:'organization_membership_removed'}, {transaction});
          }
        }
      }
      if (membership.isPrimary || user.organizationId === organization.id) {
        const nextPrimary = await OrganizationUser.findOne({where:{userId:user.id,isActive:true},order:[['createdAt','ASC']],transaction});
        if (nextPrimary?.organizationId) await setPrimaryOrganizationMembership(models,user.id,nextPrimary.organizationId,transaction);
        else await User.update({organizationId:null},{where:{id:user.id},transaction});
      }
    });
    const io = getSocketServer();
    if (io) {
      const sockets = await io.in(`user:${req.params.userId}`).fetchSockets();
      for (const socket of sockets) if (socket.data?.auth?.organizationId === organization.id) socket.disconnect(true);
    }
    return res.status(200).json({ok:true,message:'User removed from organization.'});
  } catch (err) {
    if (err.status) return res.status(err.status).json({ok:false,message:err.message});
    console.error('Remove user from organization error:',err);
    return res.status(500).json({ok:false,message:'Unable to remove user from organization.'});
  }
}

async function inviteAccountant(req, res) {
  return inviteOrganizationUserWithRole(req, res, 'accountant');
}

async function inviteOrganizationUser(req, res) {
  return inviteOrganizationUserWithRole(req, res);
}

async function inviteOrganizationUserWithRole(req, res, forcedRole) {
  try {
    if (!(req.auth?.roleCodes || []).some(code => ['administrator', 'superuser'].includes(code))) {
      return res.status(403).json({ok:false,message:'Only administrators or superusers can invite organization users.'});
    }
    const models = getOrganizationMembershipModels();
    if (!models?.Token || !models?.Role) return res.status(503).json({ok:false,message:'Database models are not ready yet.'});
    const {Organization, User, OrganizationUser, Token, Role} = models;
    if (!assertOrganizationAccess(req, req.params.id)) return res.status(404).json({ok:false,message:'Organization not found.'});
    const organization = await Organization.findByPk(req.params.id);
    if (!organization?.isActive) return res.status(404).json({ok:false,message:'Active organization not found.'});
    let roleCode = forcedRole || String(req.body?.role || 'enduser').trim().toLowerCase();
    if (!forcedRole && req.body?.roleId) {
      const role = Role && await Role.findByPk(req.body.roleId);
      if (!role?.isActive) return res.status(400).json({ok:false,message:'Select an active organization role.'});
      roleCode = String(role.code).toLowerCase();
    }
    if (!ORGANIZATION_PRESET_ROLES.includes(roleCode)) return res.status(400).json({ok:false,message:'Select an organization role. Global superuser access cannot be assigned through an organization invitation.'});
    const invitationRole = await Role.findOne({where:{code:roleCode,isActive:true}});
    if (!invitationRole) return res.status(400).json({ok:false,message:'Select an active organization role.'});
    const email = String(req.body?.email || '').trim().toLowerCase();
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const userId = String(req.body?.userId || '').trim();
    if (!userId && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255)) {
      return res.status(400).json({ok:false,message:'Enter a valid email address.'});
    }
    const result = await User.sequelize.transaction(async transaction => {
      let user = userId ? await User.findByPk(userId,{transaction,lock:transaction.LOCK.UPDATE})
        : await User.findOne({where:{email},transaction,lock:transaction.LOCK.UPDATE});
      if (userId && !user) throw fail(404,'User not found.');
      if (!user) {
        if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) throw fail(400,'First and last name are required for a new user (maximum 100 characters each).');
        user = await User.create({email,firstName,lastName,password:crypto.randomBytes(48).toString('hex'),
          organizationId:organization.id,role:'member',status:'invited',isActive:true,isEmailVerified:false},{transaction});
      }
      if (!user.isActive || user.status === 'suspended') throw fail(409,'This account is inactive or suspended.');
      const existing = await OrganizationUser.findOne({where:{organizationId:organization.id,userId:user.id},transaction});
      if (existing && existing.role !== roleCode) throw fail(409,'This user already has another role in this organization. Manage their existing assignment first.');
      const hasPrimary = Boolean(user.organizationId) || await OrganizationUser.count({where:{userId:user.id,isPrimary:true,isActive:true},transaction});
      const isPrimary = user.organizationId === organization.id || !hasPrimary;
      const membership = existing || await OrganizationUser.create({organizationId:organization.id,userId:user.id,
        role:roleCode,isActive:true,isPrimary},{transaction});
      if (existing && !existing.isActive) await existing.update({isActive:true},{transaction});
      if (!hasPrimary) await user.update({organizationId:organization.id},{transaction});
      const expiresInMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
      let setPasswordUrl;
      if (!user.isEmailVerified || user.status !== 'active') {
        const rawToken = crypto.randomBytes(48).toString('hex');
        await Token.create({userId:user.id,tokenHash:crypto.createHash('sha256').update(rawToken).digest('hex'),
          type:'reset_password',scope:'organization_invite',expiresAt:new Date(Date.now()+expiresInMinutes*60000),
          ipAddress:req.ip || null,userAgent:req.get('user-agent') || null,isActive:true,
          metadata:{organizationId:organization.id,invitedByUserId:req.auth.userId,email:user.email}}, {transaction});
        setPasswordUrl = buildSetPasswordUrl(rawToken);
      }
      return {user,membership,created:!existing,setPasswordUrl,expiresInMinutes};
    });
    let inviteEmail;
    try {
      await sendOrganizationUserInviteEmail({toEmail:result.user.email,toName:[result.user.firstName,result.user.lastName].join(' '),
        organizationName:organization.name,roleName:invitationRole.name || roleCode,expiresInMinutes:result.expiresInMinutes,setPasswordUrl:result.setPasswordUrl,
        loginUrl:result.setPasswordUrl ? undefined : `${String(process.env.APP_BASE_URL || 'http://localhost').replace(/\/+$/,'')}/login`});
      inviteEmail = {sent:true};
    } catch (err) {
      console.error('Organization invite email error:', err);
      inviteEmail = {sent:false,message:'Organization access was added, but the invitation email could not be sent. Retry the invitation.'};
    }
    return res.status(result.created ? 201 : 200).json({ok:true,message:inviteEmail.sent ? 'Organization invitation sent.' : inviteEmail.message,
      data:{id:result.membership.id,userId:result.user.id,organizationId:organization.id,role:roleCode,isActive:true,inviteEmail}});
  } catch (err) {
    if (err.status) return res.status(err.status).json({ok:false,message:err.message});
    console.error('Invite organization user error:',err);
    return res.status(500).json({ok:false,message:'Unable to invite organization user.'});
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
    const registrationError = normalizeTaxRegistration(payload);
    if (registrationError) return res.status(400).json({ ok: false, message: registrationError });
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
  inviteAccountant,
  inviteOrganizationUser,
  removeUserFromOrganization,
  updateOrganization,
  deleteOrganization,
};
