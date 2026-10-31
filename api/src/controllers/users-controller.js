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
const { fail } = require('../services/debt-amounts');
const { ORGANIZATION_PRESET_ROLES } = require('../services/accountant-access');
const { membershipLabel } = require('../services/organization-role-presets');
const {
  assignPresetRole,
  addMemberRole,
  removeMemberRole,
  resolveAssignableRole,
  memberRoleSummaries,
  refreshMemberSockets,
} = require('../services/organization-role-service');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
  applyOrganizationWhereScope,
} = require('../services/request-scope');
const { assertSeatAvailable } = require('../services/license-service');

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

function isRequesterAdministrator(req) {
  const roleCodes = req.auth?.roleCodes || [];
  return roleCodes.some((code) => String(code || '').toLowerCase() === 'administrator');
}

// Non-superusers may only grant organization preset roles, and never a role above their own.
function roleGrantDenial(req, role) {
  if (isRequesterSuperuser(req)) {
    return null;
  }
  const code = String(role?.code || '').toLowerCase();
  if (code === 'superuser') {
    return 'Only superusers can assign the SUPERUSER role.';
  }
  if (!ORGANIZATION_PRESET_ROLES.includes(code)) {
    return 'Only superusers can assign custom global roles.';
  }
  if (code === 'administrator' && !isRequesterAdministrator(req)) {
    return 'Only administrators can assign the ADMINISTRATOR role.';
  }
  return null;
}

// The same rule for roles an organization owns: an administrator role or a custom role can carry
// anything the organization has given it, so only administrators hand those out.
function organizationRoleGrantDenial(req, role) {
  if (isRequesterSuperuser(req) || isRequesterAdministrator(req)) return null;
  return role.presetCode && role.presetCode !== 'administrator'
    ? null
    : 'Only administrators can assign this role.';
}

function isRoleAdministrator(req) {
  return isRequesterSuperuser(req) || isRequesterAdministrator(req);
}

// Credential and identity changes on another account are limited to users the requester fully controls.
async function credentialEditDenial(req, models, user) {
  // Your own credentials change only through Profile, which re-checks the current password,
  // so a stolen session cannot rewrite them here
  if (user.id === req.auth?.userId) {
    return 'Use Profile settings to change your own email, password or role.';
  }
  if (isRequesterSuperuser(req)) {
    return null;
  }
  const assignments = models.UserRole && models.Role
    ? await models.UserRole.findAll({
      where: { userId: user.id, isActive: true },
      include: [{ model: models.Role, as: 'role', required: true, attributes: ['code'] }],
    })
    : [];
  const targetCodes = assignments.map((assignment) => String(assignment.role?.code || '').toLowerCase());
  if (targetCodes.includes('superuser')) {
    return 'Only superusers can change a superuser account.';
  }
  const otherMemberships = models.OrganizationUser
    ? await models.OrganizationUser.count({
      where: { userId: user.id, isActive: true, organizationId: { [Op.ne]: getAuthenticatedOrganizationId(req) } },
    })
    : 0;
  if (otherMemberships > 0) {
    return 'This user also belongs to another organization. Ask them to use Forgot password instead.';
  }
  const membership = models.OrganizationUser
    ? await models.OrganizationUser.findOne({ where: { userId: user.id, organizationId: getAuthenticatedOrganizationId(req) } })
    : null;
  const targetIsAdministrator = targetCodes.includes('administrator') || String(membership?.role || '').toLowerCase() === 'administrator';
  if (targetIsAdministrator && !isRequesterAdministrator(req)) {
    return 'Only administrators can change an administrator account.';
  }
  return null;
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

async function setPrimaryOrganizationMembership(models, userId, organizationId, transaction) {
  if (!models?.OrganizationUser || !userId || !organizationId) {
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

  if (models.User) {
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
}

// Roles belong to one organization, so only the member's role there decides who is notified.
function hasRoleCode(roleCodes = [], membershipRole = '') {
  const allowed = roleCodes.map((value) => String(value || '').toLowerCase());
  return allowed.includes(String(membershipRole || '').toLowerCase());
}

async function collectOrganizationAdministratorRecipients(models, organizationId) {
  if (!models?.Organization || !organizationId) {
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
  });

  const recipients = [];
  const seenEmails = new Set();
  for (const user of orgUsers || []) {
    const email = String(user?.email || '').toLowerCase().trim();
    if (!user?.isActive || !email || seenEmails.has(email)) {
      continue;
    }
    const membershipRole = String(user?.OrganizationUser?.role || '').toLowerCase();
    if (!hasRoleCode(['administrator'], membershipRole)) {
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
    const { User, Role, UserRole, OrganizationUser, OrganizationRole, Token, Organization } = models;

    const payload = cleanUndefined(pickUserPayload(req.body));
    const requesterIsSuper = isRequesterSuperuser(req);
    if (!requesterIsSuper) {
      payload.organizationId = getAuthenticatedOrganizationId(req);
    }
    if (payload.email) {
      payload.email = String(payload.email).toLowerCase().trim();
    }
    for (const field of ['firstName', 'lastName']) {
      if (typeof payload[field] === 'string') payload[field] = payload[field].trim();
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
    const fieldLimits = {
      firstName: 100, lastName: 100, email: 255, phone: 30,
      addressLine1: 255, addressLine2: 255, city: 100, state: 100,
      postalCode: 20, country: 100,
    };
    for (const [field, maximum] of Object.entries(fieldLimits)) {
      if (payload[field] !== undefined && payload[field] !== null &&
          (typeof payload[field] !== 'string' || payload[field].length > maximum)) {
        return res.status(400).json({ ok: false, message: `${field} must be text with at most ${maximum} characters.` });
      }
    }
    if (typeof payload.password !== 'string') {
      return res.status(400).json({ ok: false, message: 'password must be text.' });
    }
    if (!await Organization.findByPk(payload.organizationId, { attributes: ['id'] })) {
      return res.status(400).json({ ok: false, message: 'organizationId does not reference an existing organization.' });
    }
    if (await User.findOne({ where: { email: payload.email }, attributes: ['id'] })) {
      return res.status(409).json({ ok: false, message: 'A user with this email already exists.' });
    }

    const requestedRoleIds = parseRoleIds(req.body?.roleIds);
    const requestedRoleCodes = parseRoleCodes(req.body?.role);
    const resolvedRoles = [];
    // Roles the requester picked from this organization's own catalogue.
    const organizationRoles = [];

    if (requestedRoleIds.length > 0) {
      const ownRoles = OrganizationRole
        ? await OrganizationRole.findAll({ where: { id: requestedRoleIds, organizationId: payload.organizationId, isActive: true } })
        : [];
      organizationRoles.push(...ownRoles);
      const remainingRoleIds = requestedRoleIds.filter((id) => !ownRoles.some((role) => role.id === id));
      const rolesById = remainingRoleIds.length
        ? await Role.findAll({
          where: {
            id: remainingRoleIds,
            isActive: true,
          },
        })
        : [];
      if (rolesById.length !== remainingRoleIds.length) {
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

    const roleDenial = [
      ...resolvedRoles.map((role) => roleGrantDenial(req, role)),
      ...organizationRoles.map((role) => organizationRoleGrantDenial(req, role)),
    ].find(Boolean);
    if (roleDenial) {
      return res.status(403).json({ ok: false, message: roleDenial });
    }
    if (resolvedRoles.length === 0 && organizationRoles.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'At least one role is required.',
      });
    }

    const resolvedCodes = resolvedRoles.map((role) => String(role.code || '').toLowerCase());
    // Only superuser is granted globally. Other global roles are templates that organizations copy.
    if (resolvedCodes.some((code) => code !== 'superuser' && !ORGANIZATION_PRESET_ROLES.includes(code))) {
      return res.status(400).json({ ok: false, message: 'Custom global roles no longer grant access. Assign one of the organization’s own roles.' });
    }
    payload.role = resolvedCodes.includes('superuser')
      ? 'superuser'
      : membershipLabel([...resolvedCodes, ...organizationRoles.map((role) => role.presetCode).filter(Boolean)]);

    // Commit the account and its access together. A later failure must not leave
    // an orphan account that makes every retry fail on the unique email index.
    const user = await User.sequelize.transaction(async transaction => {
      const created = await User.create(payload, { transaction });
      // Platform superusers never take one of an organization's licensed seats.
      if (created.organizationId && created.isActive !== false && !resolvedCodes.includes('superuser')) {
        await assertSeatAvailable(models, created.organizationId, { userId: created.id, transaction });
      }
      if (OrganizationUser && created.organizationId) {
        await OrganizationUser.findOrCreate({
          where: { organizationId: created.organizationId, userId: created.id },
          defaults: {
            role: String(payload.role || 'member').toLowerCase(),
            isActive: created.isActive !== false,
            isPrimary: true,
          },
          transaction,
        });
        await setPrimaryOrganizationMembership(models, created.id, created.organizationId, transaction);
      }
      const platformRoles = resolvedRoles.filter((role) => String(role.code).toLowerCase() === 'superuser');
      if (platformRoles.length) {
        await UserRole.bulkCreate(
          platformRoles.map((role) => ({
            userId: created.id,
            roleId: role.id,
            assignedByUserId: req.auth?.userId || null,
          })),
          { transaction }
        );
      }
      const actor = { userId: req.auth?.userId, isSuperuser: requesterIsSuper };
      const organizationId = created.organizationId;
      for (const code of resolvedCodes) {
        await assignPresetRole(models, { organizationId, userId: created.id, code, actor, transaction });
      }
      for (const role of organizationRoles) {
        await addMemberRole(models, { organizationId, userId: created.id, roleId: role.id, actor, transaction });
      }
      return created;
    });

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
    if (err.name === 'SequelizeUniqueConstraintError') {
      // MySQL/Sequelize may report the index name instead of the attribute.
      const constraintFields = [...Object.keys(err.fields || {}), ...(err.errors || []).map(error => error.path)];
      const emailConflict = constraintFields.some(field => ['email', 'users_email'].includes(String(field || '').split('.').pop()));
      return res.status(409).json({ ok: false, message: emailConflict
        ? 'A user with this email already exists.'
        : 'A conflicting user record already exists. Reload before trying again.' });
    }
    if (err.name === 'SequelizeValidationError') {
      return res.status(400).json({ ok: false, message: 'Invalid user details. Check the email address and required fields.' });
    }
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    // Do not log SQL, bound values or a submitted password.
    console.error('Create user error:', { name: err.name, code: err.original?.code || err.parent?.code });
    return res.status(500).json({ ok: false, message: 'Unable to create user.' });
  }
}

// Administrators act inside their own organization. Platform staff name one, or use the user's primary.
function roleTargetOrganizationId(req, user) {
  if (!isRequesterSuperuser(req)) return getAuthenticatedOrganizationId(req);
  const organizationId = String(req.query?.organizationId || req.body?.organizationId || user.organizationId || '').trim();
  if (!organizationId) throw fail(400, 'Select an organization.');
  return organizationId;
}

async function userAssignmentOrganization(req, models) {
  if (!(req.auth?.roleCodes || []).some(code => ['administrator', 'superuser'].includes(String(code).toLowerCase()))) {
    throw fail(403, 'Only administrators or superusers can assign existing users.');
  }
  const requested = String(req.body?.organizationId || '').trim();
  const organizationId = isRequesterSuperuser(req) ? requested : getAuthenticatedOrganizationId(req);
  if (!organizationId) throw fail(400, 'Select an organization.');
  if (!isRequesterSuperuser(req) && requested && requested !== organizationId) throw fail(403, 'You cannot assign users to another organization.');
  const organization = await models.Organization.findByPk(organizationId, { attributes: ['id', 'name', 'legalName', 'isActive'] });
  if (!organization?.isActive) throw fail(404, 'Active organization not found.');
  return organization;
}

function assignmentEmail(value) {
  if (typeof value !== 'string') throw fail(400, 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  return email;
}

function existingUserSuggestion(user, membership, organizationId) {
  if (!user) return null;
  const alreadyAssigned = membership ? membership.isActive : user.organizationId === organizationId;
  return {
    id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
    alreadyAssigned: Boolean(alreadyAssigned),
    canAssign: user.isActive && !['suspended', 'disabled', 'blocked'].includes(user.status) && !alreadyAssigned,
    inactiveMembership: Boolean(membership && !membership.isActive),
    membershipRole: membership?.role || (alreadyAssigned ? user.role : null),
  };
}

// Exact-email discovery for the create flow. Return only the identity needed to
// confirm assignment; never expose other memberships, credentials or tokens.
async function lookupExistingUser(req, res) {
  try {
    const models = getModels();
    if (!models?.User || !models?.Organization || !models?.OrganizationUser) return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    const organization = await userAssignmentOrganization(req, models);
    const email = assignmentEmail(req.body?.email);
    const user = await models.User.findOne({ where: { email }, attributes: ['id', 'firstName', 'lastName', 'email', 'organizationId', 'role', 'isActive', 'status'] });
    const membership = user && await models.OrganizationUser.findOne({ where: { userId: user.id, organizationId: organization.id } });
    res.set?.('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, data: existingUserSuggestion(user, membership, organization.id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    console.error('Existing user lookup error:', { name: err.name });
    return res.status(500).json({ ok: false, message: 'Unable to check this email address.' });
  }
}

async function assignExistingUser(req, res) {
  try {
    const models = getModels();
    if (!models?.User || !models?.Organization || !models?.OrganizationUser || !models?.Role) return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    const organization = await userAssignmentOrganization(req, models);
    const email = assignmentEmail(req.body?.email);
    const userId = String(req.body?.userId || '').trim();
    if (!userId) throw fail(400, 'Select the existing user.');
    const roleId = String(req.body?.roleId || '').trim();
    if (!roleId) throw fail(400, 'Select an active organization role.');
    const role = await resolveAssignableRole(models, organization.id, { roleId });
    if (!role?.isActive) throw fail(400, 'Select an active organization role. Global roles cannot be assigned here.');
    const roleLabel = role.presetCode || 'member';
    const result = await models.User.sequelize.transaction(async transaction => {
      // Serialize assignments for this user, preserving every other membership
      // and the current primary organization even for simultaneous requests.
      const user = await models.User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || String(user.email).trim().toLowerCase() !== email) throw fail(409, 'The user email changed. Check the email address again.');
      if (!user.isActive || ['suspended', 'disabled', 'blocked'].includes(user.status)) throw fail(409, 'This account is inactive or suspended.');
      const where = { userId: user.id, organizationId: organization.id };
      const membership = await models.OrganizationUser.findOne({ where, transaction });
      if (membership?.isActive || (!membership && user.organizationId === organization.id)) return { alreadyAssigned: true, userId: user.id };
      if (membership && membership.role !== roleLabel) throw fail(409, 'Reactivate this membership with its existing role, or manage its organization assignment separately.');
      await assertSeatAvailable(models, organization.id, { userId: user.id, transaction });
      const hasPrimary = Boolean(user.organizationId) || await models.OrganizationUser.count({ where: { userId: user.id, isPrimary: true, isActive: true }, transaction });
      if (membership) await membership.update({ isActive: true, isPrimary: user.organizationId === organization.id || !hasPrimary }, { transaction });
      else await models.OrganizationUser.create({ ...where, role: roleLabel, isActive: true, isPrimary: !hasPrimary }, { transaction });
      if (!hasPrimary) await user.update({ organizationId: organization.id }, { transaction });
      await addMemberRole(models, {
        organizationId: organization.id, userId: user.id, roleId: role.id,
        actor: { userId: req.auth?.userId, isSuperuser: isRequesterSuperuser(req) }, transaction,
      });
      return { alreadyAssigned: false, userId: user.id };
    });
    return res.status(result.alreadyAssigned ? 200 : 201).json({ ok: true,
      message: result.alreadyAssigned ? 'User already belongs to this organization.' : 'Existing user assigned to organization.',
      data: { ...result, organizationId: organization.id } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
    console.error('Assign existing user error:', { name: err.name });
    return res.status(500).json({ ok: false, message: 'Unable to assign existing user.' });
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
    const organizationId = isPrivilegedRequest(req) ? req.query.organizationId : getAuthenticatedOrganizationId(req);
    if (!isPrivilegedRequest(req) && !organizationId) return res.status(400).json({ ok: false, message: 'organizationId is required for this user.' });
    let memberships = [];
    if (organizationId && models.OrganizationUser) {
      memberships = await models.OrganizationUser.findAll({ where: { organizationId }, attributes: ['userId', 'role', 'isActive'] });
      // Explicit inactive memberships override legacy primary-organization
      // access. Shared accounts belong in every active organization's list.
      const activeIds = memberships.filter(m => m.isActive && (!req.query.role || m.role === req.query.role)).map(m => m.userId);
      where[Op.and] = [{ [Op.or]: [
        { id: { [Op.in]: activeIds } },
        { organizationId, id: { [Op.notIn]: memberships.map(m => m.userId) }, ...(req.query.role ? { role: req.query.role } : {}) },
      ] }];
    } else if (organizationId) where.organizationId = organizationId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.role && !memberships.length) where.role = req.query.role;

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

    const roleSummaries = await memberRoleSummaries(models, organizationId, rows.map((user) => user.id));
    return res.status(200).json({
      ok: true,
      data: rows.map(user => {
        const canManageAccount = isPrivilegedRequest(req) || user.organizationId === getAuthenticatedOrganizationId(req);
        const result = canManageAccount ? sanitizeUser(user) : {
          id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
          status: user.status, isActive: user.isActive, isEmailVerified: user.isEmailVerified,
        };
        const membership = memberships.find(m => m.userId === user.id && m.isActive);
        if (membership) result.role = membership.role;
        if (organizationId) result.organizationRoles = roleSummaries.get(user.id) || [];
        result.canManageAccount = canManageAccount;
        return result;
      }),
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
          through: { attributes: ['id', 'role', 'isActive', 'isPrimary', 'createdAt', 'updatedAt'], where: { isActive: true } },
        },
      ],
    });
    if (!user) {
      return res.status(404).json({ ok: false, message: 'User not found.' });
    }

    const data = sanitizeUser(user);
    // What this person does in other organizations is not this organization's business.
    if (!isPrivilegedRequest(req)) {
      const scopedOrganizationId = getAuthenticatedOrganizationId(req);
      data.organizations = (data.organizations || []).filter((organization) => organization.id === scopedOrganizationId);
      data.roles = [];
    }
    return res.status(200).json({ ok: true, data });
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

    const changesPassword = Boolean(payload.password);
    const changesEmail = Boolean(payload.email) && payload.email !== String(user.email || '').toLowerCase();
    const nextRole = payload.role === undefined ? undefined : String(payload.role || '').toLowerCase().trim();
    const changesRole = nextRole !== undefined && nextRole !== String(user.role || '').toLowerCase();
    if (changesPassword || changesEmail || changesRole) {
      const denial = await credentialEditDenial(req, models, user);
      if (denial) {
        return res.status(403).json({ ok: false, message: denial });
      }
    }
    if (changesRole && nextRole !== 'member') {
      const roleDenial = roleGrantDenial(req, { code: nextRole });
      if (roleDenial) {
        return res.status(403).json({ ok: false, message: roleDenial });
      }
    }

    // Reactivating an account, or moving it into an organization it is not active in, takes a seat there.
    const seatOrganizationIds = new Set();
    if (payload.isActive === true && user.isActive === false && models.OrganizationUser) {
      const memberships = await models.OrganizationUser.findAll({ where: { userId: user.id, isActive: true }, attributes: ['organizationId'] });
      memberships.forEach((membership) => seatOrganizationIds.add(membership.organizationId));
      if (user.organizationId) seatOrganizationIds.add(user.organizationId);
    }
    if (payload.organizationId && payload.organizationId !== user.organizationId && models.OrganizationUser) {
      const membership = await models.OrganizationUser.findOne({ where: { userId: user.id, organizationId: payload.organizationId, isActive: true } });
      if (!membership) seatOrganizationIds.add(payload.organizationId);
    }
    for (const organizationId of seatOrganizationIds) {
      await assertSeatAvailable(models, organizationId, { userId: user.id });
    }

    await user.update(payload);

    // A credential change by someone else ends the account's existing sessions and lifts any lockout
    if (changesPassword || changesEmail) {
      if (models.Token) {
        await models.Token.update(
          { isActive: false, revokedAt: new Date(), revokedReason: 'credentials_changed_by_admin' },
          { where: { userId: user.id, type: ['access', 'refresh', 'reset_password'], isActive: true, revokedAt: null } }
        );
      }
      if (changesPassword && models.InvalidLoginAttempt) {
        await models.InvalidLoginAttempt.destroy({ where: { userId: user.id } });
      }
    }

    // Keep multi-organization primary membership in sync when default organization changes.
    if (payload.organizationId && models.OrganizationUser) {
      // A role held elsewhere never carries over: roles here are assigned deliberately.
      await models.OrganizationUser.findOrCreate({
        where: {
          userId: user.id,
          organizationId: payload.organizationId,
        },
        defaults: {
          userId: user.id,
          organizationId: payload.organizationId,
          role: 'member',
          isActive: true,
          isPrimary: true,
        },
      });
      await setPrimaryOrganizationMembership(models, user.id, payload.organizationId);
    }

    return res.status(200).json({ ok: true, data: sanitizeUser(user) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
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
    const profileImageUrls = await User.sequelize.transaction(async (transaction) => {
      const user = await User.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw fail(404, 'User not found.');
      // Check the persisted account flag under a lock so reactivation cannot
      // race the check and deletion. Status alone does not deactivate an account.
      if (user.isActive !== false) throw fail(409, 'Deactivate this user before deleting the account.');

      const urls = Array.from(
        new Set(
          [
            String(user.profileImageCdnUrl || '').trim(),
            String(user.profileImageUrl || '').trim(),
          ].filter(Boolean)
        )
      );
      await user.destroy({ transaction });
      return urls;
    });
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
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
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
      whereRole.code = ORGANIZATION_PRESET_ROLES.filter(
        (code) => code !== 'administrator' || isRequesterAdministrator(req)
      );
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
    if (!isRoleAdministrator(req)) {
      return res.status(403).json({ ok: false, message: 'Only administrators can change roles.' });
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

    const roleId = String(req.body?.roleId || '').trim();
    if (!roleId) {
      return res.status(400).json({ ok: false, message: 'roleId is required.' });
    }

    const role = await Role.findOne({ where: { id: roleId, isActive: true } });
    if (!role) {
      return res.status(404).json({ ok: false, message: 'Role not found or inactive.' });
    }
    const roleDenial = roleGrantDenial(req, role);
    if (roleDenial) {
      return res.status(403).json({ ok: false, message: roleDenial });
    }

    if (String(role.code).toLowerCase() !== 'superuser') {
      const allModels = getModels();
      const organizationId = roleTargetOrganizationId(req, user);
      await allModels.OrganizationRole.sequelize.transaction(async (transaction) => {
        const assigned = await assignPresetRole(allModels, {
          organizationId, userId: user.id, code: role.code,
          actor: { userId: req.auth?.userId, isSuperuser: isRequesterSuperuser(req) }, transaction,
        });
        if (!assigned) throw fail(400, 'Assign custom roles from the organization’s role page.');
      });
      await refreshMemberSockets(allModels, organizationId, user.id);
      return res.status(201).json({ ok: true, message: 'Role assigned to user successfully.', data: { organizationId, roleCode: role.code } });
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
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
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
    const { User, Role, UserRole } = models;
    if (!isRoleAdministrator(req)) {
      return res.status(403).json({ ok: false, message: 'Only administrators can change roles.' });
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
    const role = await Role.findByPk(roleId);

    const roleDenial = roleGrantDenial(req, role);
    if (roleDenial) {
      return res.status(403).json({ ok: false, message: roleDenial.replace('assign', 'remove') });
    }

    if (role && String(role.code).toLowerCase() !== 'superuser') {
      const allModels = getModels();
      const organizationId = roleTargetOrganizationId(req, user);
      await allModels.OrganizationRole.sequelize.transaction(async (transaction) => {
        const own = await resolveAssignableRole(allModels, organizationId, { code: role.code }, transaction);
        if (!own) throw fail(404, 'User role assignment not found.');
        await removeMemberRole(allModels, {
          organizationId, userId: user.id, roleId: own.id,
          actor: { userId: req.auth?.userId, isSuperuser: isRequesterSuperuser(req) }, transaction,
        });
        if (membership) await membership.destroy({ transaction });
      });
      await refreshMemberSockets(allModels, organizationId, user.id);
      return res.status(200).json({ ok: true, message: 'Role removed from user successfully.' });
    }

    if (!membership) {
      return res.status(404).json({ ok: false, message: 'User role assignment not found.' });
    }

    await membership.destroy();
    return res.status(200).json({ ok: true, message: 'Role removed from user successfully.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
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
          through: { attributes: [], where: { isActive: true } },
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

    const activeMembership = await OrganizationUser.findOne({ where: { userId: user.id, organizationId: organization.id, isActive: true } });
    if (!activeMembership) {
      await assertSeatAvailable(getModels(), organization.id, { userId: user.id });
    }

    const [membership, created] = await OrganizationUser.findOrCreate({
      where: {
        userId: user.id,
        organizationId: organization.id,
      },
      defaults: {
        userId: user.id,
        organizationId: organization.id,
        // A role held elsewhere never carries over to this organization.
        role: 'member',
        isActive: true,
        isPrimary: shouldSetPrimary,
      },
    });
    const reinstated = !created && !membership.isActive;

    if (!created) {
      const nextPayload = { isActive: true };
      if (requestedIsPrimary !== undefined) {
        nextPayload.isPrimary = requestedIsPrimary;
      }
      await membership.update(nextPayload);
    }

    // A reinstated member gets back the role kept on this membership. A new member starts with
    // the role named in the request, or none until someone assigns one.
    const allModels = getModels();
    if (allModels.OrganizationRole && (reinstated || req.body?.roleId)) {
      const actor = { userId: req.auth?.userId, isSuperuser: true };
      await allModels.OrganizationRole.sequelize.transaction(async (transaction) => {
        if (reinstated) await assignPresetRole(allModels, { organizationId: organization.id, userId: user.id, code: membership.role, actor, transaction });
        if (req.body?.roleId) {
          const role = await resolveAssignableRole(allModels, organization.id, { roleId: req.body.roleId }, transaction);
          if (!role?.isActive) throw fail(400, 'Select an active organization role.');
          await addMemberRole(allModels, { organizationId: organization.id, userId: user.id, roleId: role.id, actor, transaction });
        }
      });
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
    if (err.status) return res.status(err.status).json({ ok: false, message: err.message });
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

    const organizationId = String(req.params.organizationId || '').trim();
    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'organizationId is required.' });
    }

    // Use the same transaction, session revocation and history-preserving
    // membership removal as the organization's member-management endpoint.
    return require('./organizations-controller').removeUserFromOrganization({
      ...req, params: { ...req.params, id: organizationId, userId: req.params.id },
    }, res);
  } catch (err) {
    console.error('Remove organization from user error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to remove organization from user.' });
  }
}

module.exports = {
  lookupExistingUser,
  assignExistingUser,
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
