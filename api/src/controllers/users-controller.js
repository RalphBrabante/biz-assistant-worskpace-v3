const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const {
  sendOrganizationUserInviteEmail,
  sendUserCreatedAdminNotificationEmail,
} = require('../services/email-service');
const {
  createOrganizationMessage,
  getActorDisplayName,
} = require('../services/message-service');
const { deleteRemoteFileByUrl } = require('../services/storage-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');

function getUserModel() {
  const models = getModels();
  if (!models || !models.User) {
    return null;
  }
  return models.User;
}

function getUserRoleModels() {
  const models = getModels();
  if (!models || !models.User || !models.Role || !models.UserRole) {
    return null;
  }
  return {
    User: models.User,
    Role: models.Role,
    UserRole: models.UserRole,
  };
}

function getUserOrganizationModels() {
  const models = getModels();
  if (!models || !models.User || !models.Organization || !models.OrganizationUser) {
    return null;
  }
  return {
    User: models.User,
    Organization: models.Organization,
    OrganizationUser: models.OrganizationUser,
  };
}

function pickUserPayload(body = {}) {
  return {
    organizationId: body.organizationId,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    password: body.password,
    phone: body.phone,
    addressLine1: body.addressLine1,
    addressLine2: body.addressLine2,
    city: body.city,
    state: body.state,
    postalCode: body.postalCode,
    country: body.country,
    role: body.role,
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

function isRequesterSuperuser(req) {
  const roleCodes = req.auth?.roleCodes || [];
  return roleCodes.some((code) => String(code || '').toLowerCase() === 'superuser');
}

function parseRoleIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set();
  for (const item of value) {
    const roleId = String(item || '').trim();
    if (roleId) {
      unique.add(roleId);
    }
  }
  return Array.from(unique);
}

function parseRoleCodes(value) {
  if (!value) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  const unique = new Set();
  for (const item of list) {
    const roleCode = String(item || '').toLowerCase().trim();
    if (roleCode) {
      unique.add(roleCode);
    }
  }
  return Array.from(unique);
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

function buildUserDetailsUrl(userId) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  return `${appBaseUrl.replace(/\/+$/, '')}/users/${encodeURIComponent(userId)}`;
}

function sanitizeUser(user) {
  const json = user.toJSON();
  delete json.password;
  return json;
}

async function setPrimaryOrganizationMembership(models, userId, organizationId) {
  if (!models?.OrganizationUser || !userId || !organizationId) {
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

  if (models.User) {
    await models.User.update(
      { organizationId },
      {
        where: {
          id: userId,
        },
      }
    );
  }
}

function hasRoleCode(user, roleCodes = [], membershipRole = '') {
  const allowed = roleCodes.map((value) => String(value || '').toLowerCase());
  const primaryRole = String(user?.role || '').toLowerCase();
  if (primaryRole && allowed.includes(primaryRole)) {
    return true;
  }
  const orgMembershipRole = String(membershipRole || '').toLowerCase();
  if (orgMembershipRole && allowed.includes(orgMembershipRole)) {
    return true;
  }
  const memberships = Array.isArray(user?.roles) ? user.roles : [];
  return memberships.some((role) => allowed.includes(String(role?.code || '').toLowerCase()));
}

async function collectOrganizationAdministratorRecipients(models, organizationId) {
  if (!models?.Organization || !models?.User || !models?.Role || !organizationId) {
    return { organization: null, recipients: [] };
  }

  const organization = await models.Organization.findByPk(organizationId);
  if (!organization) {
    return { organization: null, recipients: [] };
  }

  const orgUsers = await organization.getUsers({
    attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
    through: {
      where: { isActive: true },
      attributes: ['role', 'isActive'],
    },
    include: [
      {
        model: models.Role,
        as: 'roles',
        through: { attributes: [] },
        required: false,
      },
    ],
  });

  const primaryUsers = await models.User.findAll({
    where: {
      organizationId,
      isActive: true,
    },
    attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'isActive'],
    include: [
      {
        model: models.Role,
        as: 'roles',
        through: { attributes: [] },
        required: false,
      },
    ],
  });

  const recipients = [];
  const seenEmails = new Set();
  const candidates = [...(orgUsers || []), ...(primaryUsers || [])];
  for (const user of candidates) {
    const email = String(user?.email || '').toLowerCase().trim();
    if (!user?.isActive || !email || seenEmails.has(email)) {
      continue;
    }
    const membershipRole = String(user?.OrganizationUser?.role || '').toLowerCase();
    if (!hasRoleCode(user, ['administrator'], membershipRole)) {
      continue;
    }

    seenEmails.add(email);
    recipients.push({
      email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || email,
    });
  }

  return { organization, recipients };
}

async function createUser(req, res) {
  try {
    const models = getModels();
    if (
      !models ||
      !models.User ||
      !models.Role ||
      !models.UserRole ||
      !models.Token ||
      !models.Organization
    ) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role, UserRole, OrganizationUser, Token, Organization } = models;

    const payload = cleanUndefined(pickUserPayload(req.body));
    const requesterIsSuper = isRequesterSuperuser(req);
    if (!requesterIsSuper) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }

    if (!payload.firstName) {
      return res.status(400).json({ ok: false, message: 'firstName is required.' });
    }
    if (!payload.lastName) {
      return res.status(400).json({ ok: false, message: 'lastName is required.' });
    }
    if (!payload.email) {
      return res.status(400).json({ ok: false, message: 'email is required.' });
    }
    if (!payload.password) {
      return res.status(400).json({ ok: false, message: 'password is required.' });
    }
    if (!payload.organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const requestedRoleIds = parseRoleIds(req.body?.roleIds);
    const requestedRoleCodes = parseRoleCodes(req.body?.role);
    const resolvedRoles = [];

    if (requestedRoleIds.length > 0) {
      const rolesById = await Role.findAll({
        where: {
          id: requestedRoleIds,
          isActive: true,
        },
      });
      if (rolesById.length !== requestedRoleIds.length) {
        return res.status(400).json({ ok: false, message: 'Some selected roles are invalid or inactive.' });
      }
      resolvedRoles.push(...rolesById);
    }

    if (requestedRoleCodes.length > 0) {
      const rolesByCode = await Role.findAll({
        where: {
          code: requestedRoleCodes,
          isActive: true,
        },
      });
      for (const role of rolesByCode) {
        if (!resolvedRoles.some((existing) => existing.id === role.id)) {
          resolvedRoles.push(role);
        }
      }
    }

    const hasSuperuserRole = resolvedRoles.some(
      (role) => String(role.code || '').toLowerCase() === 'superuser'
    );
    if (hasSuperuserRole && !requesterIsSuper) {
      return res.status(403).json({
        ok: false,
        message: 'Only superusers can assign the SUPERUSER role.',
      });
    }
    if (resolvedRoles.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'At least one role is required.',
      });
    }

    if (resolvedRoles.length > 0) {
      payload.role = String(resolvedRoles[0].code || payload.role || 'member')
        .toLowerCase()
        .trim();
    }

    const user = await User.create(payload);
    if (OrganizationUser && user.organizationId) {
      await OrganizationUser.findOrCreate({
        where: {
          organizationId: user.organizationId,
          userId: user.id,
        },
        defaults: {
          role: String(payload.role || 'member').toLowerCase(),
          isActive: user.isActive !== false,
          isPrimary: true,
        },
      });
      await setPrimaryOrganizationMembership(models, user.id, user.organizationId);
    }
    if (resolvedRoles.length > 0) {
      await UserRole.bulkCreate(
        resolvedRoles.map((role) => ({
          userId: user.id,
          roleId: role.id,
          assignedByUserId: req.auth?.userId || null,
        })),
        { ignoreDuplicates: true }
      );
    }

    let inviteEmail = { sent: false, message: 'Invite email was not sent.' };
    let adminNotification = { sent: false, attempted: 0, failed: 0 };
    const normalizedEmail = String(user.email || '').toLowerCase().trim();
    if (normalizedEmail) {
      try {
        const expiresInMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
        const rawToken = crypto.randomBytes(48).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        await Token.update(
          {
            isActive: false,
            revokedAt: new Date(),
            revokedReason: 'superseded_user_create_invite',
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
          scope: 'user_created_invite',
          expiresAt,
          ipAddress: req.ip || null,
          userAgent: req.get('user-agent') || null,
          metadata: {
            email: normalizedEmail,
            organizationId: user.organizationId,
            invitedByUserId: req.auth?.userId || null,
          },
          isActive: true,
        });

        const organization = await Organization.findByPk(user.organizationId, {
          attributes: ['id', 'name', 'legalName'],
        });
        const setPasswordUrl = buildSetPasswordUrl(rawToken);

        await sendOrganizationUserInviteEmail({
          toEmail: normalizedEmail,
          toName:
            [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || normalizedEmail,
          organizationName: organization?.name || organization?.legalName || 'your organization',
          setPasswordUrl,
          expiresInMinutes,
        });

        inviteEmail = { sent: true };
      } catch (emailErr) {
        console.error('Create user invite email error:', emailErr);
        inviteEmail = {
          sent: false,
          message: 'User was created, but invite email could not be sent.',
        };
      }
    }

    try {
      const { organization, recipients } = await collectOrganizationAdministratorRecipients(
        models,
        user.organizationId
      );
      if (recipients.length > 0) {
        const createdUserName =
          [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || normalizedEmail;
        const createdRoleLabels = resolvedRoles.map(
          (role) => role.name || String(role.code || '').toUpperCase()
        );
        const userUrl = buildUserDetailsUrl(user.id);
        const results = await Promise.allSettled(
          recipients.map((recipient) =>
            sendUserCreatedAdminNotificationEmail({
              toEmail: recipient.email,
              toName: recipient.name,
              organizationName:
                organization?.name || organization?.legalName || 'your organization',
              createdUserName,
              createdUserEmail: normalizedEmail,
              roleLabels: createdRoleLabels,
              userUrl,
            })
          )
        );
        const failed = results.filter((result) => result.status === 'rejected').length;
        adminNotification = {
          sent: failed === 0,
          attempted: recipients.length,
          failed,
        };
        if (failed > 0) {
          console.error('Create user admin notifications had failures:', {
            organizationId: user.organizationId,
            userId: user.id,
            attempted: recipients.length,
            failed,
          });
        }
      } else {
        console.warn('Create user admin notification skipped: no administrator recipients found.', {
          organizationId: user.organizationId,
          userId: user.id,
        });
      }
    } catch (notifyErr) {
      console.error('Create user admin notification error:', notifyErr);
    }

    const actorName = getActorDisplayName(req.auth?.user);
    const createdUserName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
    await createOrganizationMessage({
      organizationId: user.organizationId,
      entityType: 'user',
      entityId: user.id,
      title: 'New user added',
      message: `${actorName} just created user "${createdUserName}".`,
      createdBy: req.auth?.user?.id || req.auth?.userId || null,
      metadata: {
        email: user.email || null,
        roles: resolvedRoles.map((role) => String(role.code || '').toLowerCase()),
      },
    });

    return res.status(201).json({
      ok: true,
      message: 'User created successfully.',
      data: {
        ...sanitizeUser(user),
        inviteEmail,
        adminNotification,
      },
    });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to create user.' });
  }
}

async function listUsers(req, res) {
  try {
    const models = getModels();
    if (!models || !models.User || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Organization } = models;

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
    if (req.query.status) where.status = req.query.status;
    if (req.query.role) where.role = req.query.role;

    const isActive = parseBoolean(req.query.isActive);
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const isEmailVerified = parseBoolean(req.query.isEmailVerified);
    if (isEmailVerified !== undefined) {
      where.isEmailVerified = isEmailVerified;
    }

    if (req.query.q) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${req.query.q}%` } },
        { lastName: { [Op.like]: `%${req.query.q}%` } },
        { email: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const { rows, count } = await User.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'primaryOrganization',
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
      data: rows.map(sanitizeUser),
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch users.' });
  }
}

async function getUserById(req, res) {
  try {
    const models = getModels();
    const roleModels = getUserRoleModels();
    if (!models || !roleModels || !models.Organization) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role } = roleModels;
    const { Organization } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }

    const user = await User.findOne({
      where,
      include: [
        {
          model: Role,
          as: 'roles',
          through: { attributes: ['id', 'assignedByUserId', 'createdAt'] },
        },
        {
          model: Organization,
          as: 'organizations',
          attributes: ['id', 'name', 'legalName', 'isActive'],
          through: { attributes: ['id', 'role', 'isActive', 'isPrimary', 'createdAt', 'updatedAt'] },
        },
      ],
    });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    return res.status(200).json({ ok: true, data: sanitizeUser(user) });
  } catch (err) {
    console.error('Get user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch user.' });
  }
}

async function updateUser(req, res) {
  try {
    const models = getModels();
    const User = getUserModel();
    if (!User || !models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const payload = cleanUndefined(pickUserPayload(req.body));
    if (!isPrivilegedRequest(req)) {
      delete payload.organizationId;
    }
    if (payload.organizationId && !isRequesterSuperuser(req)) {
      delete payload.organizationId;
    }
    // isActive and status are admin-only; only superusers may set them
    if (isRequesterSuperuser(req)) {
      if (req.body.isActive !== undefined) payload.isActive = parseBoolean(req.body.isActive);
      if (req.body.status !== undefined) payload.status = String(req.body.status || '').trim() || undefined;
    }
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid fields provided for update.' });
    }

    await user.update(payload);

    // Keep multi-organization primary membership in sync when default organization changes.
    if (payload.organizationId && models.OrganizationUser) {
      await models.OrganizationUser.findOrCreate({
        where: {
          userId: user.id,
          organizationId: payload.organizationId,
        },
        defaults: {
          userId: user.id,
          organizationId: payload.organizationId,
          role: String(user.role || 'member').toLowerCase(),
          isActive: true,
          isPrimary: true,
        },
      });
      await setPrimaryOrganizationMembership(models, user.id, payload.organizationId);
    }

    return res.status(200).json({ ok: true, data: sanitizeUser(user) });
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to update user.' });
  }
}

async function deleteUser(req, res) {
  try {
    const User = getUserModel();
    if (!User) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const profileImageUrls = Array.from(
      new Set(
        [
          String(user.profileImageCdnUrl || '').trim(),
          String(user.profileImageUrl || '').trim(),
        ].filter(Boolean)
      )
    );

    await user.destroy();
    for (const fileUrl of profileImageUrls) {
      try {
        // Best-effort cleanup after delete.
        // eslint-disable-next-line no-await-in-loop
        await deleteRemoteFileByUrl(fileUrl);
      } catch (_err) {
        // Best-effort cleanup after delete.
      }
    }
    return res.status(200).json({ ok: true, message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to delete user.' });
  }
}

async function listUserAssignableRoles(req, res) {
  try {
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const whereRole = { isActive: true };
    if (!isRequesterSuperuser(req)) {
      whereRole.code = { [Op.ne]: 'superuser' };
    }

    const roles = await Role.findAll({
      where: whereRole,
      attributes: ['id', 'name', 'code', 'description'],
      order: [['name', 'ASC']],
    });

    return res.status(200).json({
      ok: true,
      data: roles,
      meta: { total: roles.length },
    });
  } catch (err) {
    console.error('List assignable roles error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch assignable roles.' });
  }
}

async function addRoleToUser(req, res) {
  try {
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Role, UserRole } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const roleId = String(req.body?.roleId || '').trim();
    if (!roleId) {
      return res.status(400).json({ ok: false, message: 'roleId is required.' });
    }

    const role = await Role.findOne({ where: { id: roleId, isActive: true } });
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found or inactive.' });
    }
    if (String(role.code || '').toLowerCase() === 'superuser' && !isRequesterSuperuser(req)) {
      return res.status(403).json({
        ok: false,
        message: 'Only superusers can assign the SUPERUSER role.',
      });
    }

    const [membership] = await UserRole.findOrCreate({
      where: { userId: user.id, roleId: role.id },
      defaults: {
        assignedByUserId: req.auth?.user?.id || null,
      },
    });

    return res.status(201).json({
      ok: true,
      message: 'Role assigned to user successfully.',
      data: membership,
    });
  } catch (err) {
    console.error('Add role to user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to assign role to user.' });
  }
}

async function removeRoleFromUser(req, res) {
  try {
    const models = getUserRoleModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, UserRole } = models;

    const where = { id: req.params.id };
    if (!isPrivilegedRequest(req)) {
      const scopedWhere = applyOrganizationWhereScope(where, req);
      if (!scopedWhere) {
        return res.status(404).json({ ok: false, message: 'User not found.' });
      }
    }
    const user = await User.findOne({ where });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const roleId = String(req.params.roleId || '').trim();
    if (!roleId) {
      return res.status(400).json({ ok: false, message: 'roleId is required.' });
    }

    const membership = await UserRole.findOne({
      where: {
        userId: user.id,
        roleId,
      },
    });

    if (!membership) {
      return res.status(404).json({ ok: false, message: 'User role assignment not found.' });
    }

    await membership.destroy();
    return res.status(200).json({ ok: true, message: 'Role removed from user successfully.' });
  } catch (err) {
    console.error('Remove role from user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove role from user.' });
  }
}

async function listUserAssignableOrganizations(req, res) {
  try {
    if (!isRequesterSuperuser(req)) {
      return res.status(403).json({
        ok: false,
        message: 'Only superusers can manage user organization memberships.',
      });
    }

    const models = getUserOrganizationModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Organization } = models;

    const user = await User.findByPk(req.params.id, {
      include: [
        {
          model: Organization,
          as: 'organizations',
          attributes: ['id'],
          through: { attributes: [] },
          required: false,
        },
      ],
    });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const assignedIds = new Set((user.organizations || []).map((org) => org.id));
    const q = String(req.query?.q || '').trim();
    const where = {
      isActive: true,
    };
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { legalName: { [Op.like]: `%${q}%` } },
        { taxId: { [Op.like]: `%${q}%` } },
      ];
    }

    const organizations = await Organization.findAll({
      where,
      attributes: ['id', 'name', 'legalName', 'taxId', 'isActive'],
      order: [['name', 'ASC']],
      limit: 500,
    });

    const data = organizations.filter((organization) => !assignedIds.has(organization.id));
    return res.status(200).json({
      ok: true,
      data,
      meta: {
        total: data.length,
      },
    });
  } catch (err) {
    console.error('List assignable organizations error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to fetch assignable organizations.' });
  }
}

async function addOrganizationToUser(req, res) {
  try {
    if (!isRequesterSuperuser(req)) {
      return res.status(403).json({
        ok: false,
        message: 'Only superusers can manage user organization memberships.',
      });
    }

    const models = getUserOrganizationModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, Organization, OrganizationUser } = models;

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const organizationId = String(req.body?.organizationId || '').trim();
    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const organization = await Organization.findOne({
      where: {
        id: organizationId,
        isActive: true,
      },
    });
    if (!organization) {
      return res.status(404).json({ ok: false, message: 'Organization not found or inactive.' });
    }

    const requestedIsPrimary = parseBoolean(req.body?.isPrimary);
    const hasExistingPrimary = await OrganizationUser.count({
      where: {
        userId: user.id,
        isPrimary: true,
      },
    });
    const shouldSetPrimary = requestedIsPrimary === true || hasExistingPrimary === 0;

    const [membership, created] = await OrganizationUser.findOrCreate({
      where: {
        userId: user.id,
        organizationId: organization.id,
      },
      defaults: {
        userId: user.id,
        organizationId: organization.id,
        role: String(user.role || 'member').toLowerCase(),
        isActive: true,
        isPrimary: shouldSetPrimary,
      },
    });

    if (!created) {
      const nextPayload = { isActive: true };
      if (requestedIsPrimary !== undefined) {
        nextPayload.isPrimary = requestedIsPrimary;
      }
      await membership.update(nextPayload);
    }

    if (shouldSetPrimary || requestedIsPrimary === true) {
      await setPrimaryOrganizationMembership(getModels(), user.id, organization.id);
      await membership.reload();
    }

    return res.status(created ? 201 : 200).json({
      ok: true,
      message: created ? 'Organization assigned to user.' : 'Organization membership updated.',
      data: {
        id: membership.id,
        userId: membership.userId,
        organizationId: membership.organizationId,
        isPrimary: membership.isPrimary,
        isActive: membership.isActive,
      },
    });
  } catch (err) {
    console.error('Add organization to user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to assign organization to user.' });
  }
}

async function removeOrganizationFromUser(req, res) {
  try {
    if (!isRequesterSuperuser(req)) {
      return res.status(403).json({
        ok: false,
        message: 'Only superusers can manage user organization memberships.',
      });
    }

    const models = getUserOrganizationModels();
    if (!models) {
      return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    }
    const { User, OrganizationUser } = models;

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const organizationId = String(req.params.organizationId || '').trim();
    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    const membership = await OrganizationUser.findOne({
      where: {
        userId: user.id,
        organizationId,
      },
    });
    if (!membership) {
      return res.status(404).json({ ok: false, message: 'User is not assigned to this organization.' });
    }

    const wasPrimary = Boolean(membership.isPrimary);
    await membership.destroy();

    if (wasPrimary) {
      const nextPrimary = await OrganizationUser.findOne({
        where: {
          userId: user.id,
          isActive: true,
        },
        order: [['createdAt', 'ASC']],
      });
      if (nextPrimary?.organizationId) {
        await setPrimaryOrganizationMembership(getModels(), user.id, nextPrimary.organizationId);
      } else {
        await User.update(
          { organizationId: null },
          {
            where: {
              id: user.id,
            },
          }
        );
      }
    }

    return res.status(200).json({ ok: true, message: 'Organization removed from user.' });
  } catch (err) {
    console.error('Remove organization from user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove organization from user.' });
  }
}

module.exports = {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  listUserAssignableRoles,
  addRoleToUser,
  removeRoleFromUser,
  listUserAssignableOrganizations,
  addOrganizationToUser,
  removeOrganizationFromUser,
};
