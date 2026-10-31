const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { effectiveRoleAccess, activeMember } = require('../services/role-access');
const { activeLicenseWhere } = require('../services/license-service');
const {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} = require('../services/email-service');

function isUserAllowedToLogin(user) {
  if (!user || !user.isActive) {
    return { ok: false, reason: 'User is inactive.' };
  }

  if (user.status !== 'active') {
    if (!user.isEmailVerified) {
      return { ok: false, reason: 'Email is not verified yet.' };
    }
    return {
      ok: false,
      reason: `User status "${user.status}" is not allowed to log in.`,
    };
  }

  if (!user.isEmailVerified) {
    return { ok: false, reason: 'Email is not verified yet.' };
  }

  return { ok: true };
}

const bcrypt = require('bcryptjs');

// Never fall back to plaintext comparison: a malformed hash must fail closed
async function comparePassword(plainPassword, storedPassword) {
  try {
    return await bcrypt.compare(String(plainPassword || ''), String(storedPassword || ''));
  } catch (_err) {
    return false;
  }
}

// Spending the same bcrypt work for unknown emails keeps response timing from revealing accounts.
// Hash of discarded random bytes: no password matches it.
const DUMMY_PASSWORD_HASH = '$2a$10$2xM6AjfNQ4JFk0hN/h7YdeuxgiyOH447i.iZBmR.DCEy94eQ5mKEu';

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
// Per client IP: stops one source guessing a password without letting strangers lock the owner out
const LOCKOUT_THRESHOLD_PER_IP = 5;
// Across all IPs: bounds distributed guessing against a single account
const LOCKOUT_THRESHOLD_PER_ACCOUNT = 20;
const ACCOUNT_LOCK_REASON = 'account_lockout';

async function failuresSinceLastLock(models, where, lockWhere = where) {
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const lastLock = await models.InvalidLoginAttempt.findOne({
    where: { ...lockWhere, lockedUntil: { [Op.ne]: null } },
    order: [['lockedUntil', 'DESC']],
    attributes: ['lockedUntil'],
  });
  // Failures that already produced a lock never count toward the next one
  const lastLockEnd = lastLock?.lockedUntil ? new Date(lastLock.lockedUntil) : null;
  const since = lastLockEnd && lastLockEnd > windowStart ? lastLockEnd : windowStart;
  return models.InvalidLoginAttempt.count({ where: { ...where, createdAt: { [Op.gte]: since } } });
}

async function resolveEffectiveOrganizationId(models, user) {
  if (!models?.OrganizationUser || !user?.id) {
    return user?.organizationId || null;
  }

  const primaryMembership = await models.OrganizationUser.findOne({
    where: {
      userId: user.id,
      isActive: true,
      isPrimary: true,
    },
    attributes: ['organizationId'],
    order: [['updatedAt', 'DESC']],
  });
  if (primaryMembership?.organizationId) {
    return primaryMembership.organizationId;
  }

  if (user.organizationId) {
    return user.organizationId;
  }

  const fallbackMembership = await models.OrganizationUser.findOne({
    where: {
      userId: user.id,
      isActive: true,
    },
    attributes: ['organizationId'],
    order: [['createdAt', 'ASC']],
  });
  return fallbackMembership?.organizationId || null;
}

async function listUserActiveOrganizations(models, user) {
  const userId = user?.id;
  if (!models || !userId || !models.Organization) {
    return [];
  }

  const organizationIds = new Set();
  if (models.OrganizationUser) {
    const memberships = await models.OrganizationUser.findAll({
      where: {
        userId,
        isActive: {
          [Op.ne]: false,
        },
      },
      attributes: ['organizationId', 'isPrimary', 'createdAt'],
      order: [
        ['isPrimary', 'DESC'],
        ['createdAt', 'ASC'],
      ],
    });
    for (const membership of memberships) {
      if (membership?.organizationId) {
        organizationIds.add(membership.organizationId);
      }
    }
  }

  if (user.organizationId && await activeMember(models, user.id, user.organizationId)) {
    organizationIds.add(user.organizationId);
  }

  const ids = Array.from(organizationIds);
  if (ids.length === 0) {
    return [];
  }

  const organizations = await models.Organization.findAll({
    where: {
      id: ids,
      isActive: {
        [Op.ne]: false,
      },
    },
    attributes: ['id', 'name', 'legalName', 'currency', 'isActive'],
    order: [['name', 'ASC']],
  });

  return organizations;
}

async function mapOrganizationLicenseStatus(models, organizationIds, now = new Date()) {
  const result = new Map();
  if (!models?.License || !organizationIds || organizationIds.length === 0) {
    return result;
  }

  const activeLicenses = await models.License.findAll({
    where: {
      organizationId: organizationIds,
      ...activeLicenseWhere(now),
    },
    attributes: ['id', 'organizationId', 'expiresAt'],
    order: [['expiresAt', 'DESC']],
  });

  for (const license of activeLicenses) {
    if (!result.has(license.organizationId)) {
      result.set(license.organizationId, license);
    }
  }

  return result;
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    const requestedOrganizationId = String(req.body?.organizationId || '').trim();

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        message: 'email and password are required.',
      });
    }

    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const user = await models.User.findOne({
      where: { email: normalizedEmail },
      include: models.Role
        ? [
            {
              model: models.Role,
              as: 'roles',
              through: { attributes: [] },
              include: models.Permission
                ? [
                    {
                      model: models.Permission,
                      as: 'permissions',
                      through: { attributes: [] },
                    },
                  ]
                : [],
            },
          ]
        : [],
    });

    const genericError = {
      ok: false,
      message: 'Invalid email or password.',
    };

    if (!user) {
      await comparePassword(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json(genericError);
    }

    const ipAddress = req.ip || null;
    // Check for an active lockout (this IP, or the whole account) before comparing the password
    const activeLock = await models.InvalidLoginAttempt.findOne({
      where: {
        userId: user.id,
        lockedUntil: { [Op.gt]: new Date() },
        [Op.or]: [{ ipAddress }, { failureReason: ACCOUNT_LOCK_REASON }],
      },
      order: [['createdAt', 'DESC']],
    });
    if (activeLock) {
      return res.status(429).json({
        ok: false,
        message: 'Account temporarily locked due to too many failed login attempts. Please try again later.',
      });
    }

    const passwordMatches = await comparePassword(password, user.password);
    if (!passwordMatches) {
      const ipFailures = (await failuresSinceLastLock(models, { userId: user.id, ipAddress })) + 1;
      const accountFailures = (await failuresSinceLastLock(
        models,
        { userId: user.id },
        { userId: user.id, failureReason: ACCOUNT_LOCK_REASON }
      )) + 1;
      const locksAccount = accountFailures >= LOCKOUT_THRESHOLD_PER_ACCOUNT;
      const locksIp = ipFailures >= LOCKOUT_THRESHOLD_PER_IP;
      await models.InvalidLoginAttempt.create({
        userId: user.id,
        attemptedEmail: normalizedEmail,
        ipAddress,
        userAgent: req.get('user-agent') || null,
        failureReason: locksAccount ? ACCOUNT_LOCK_REASON : 'invalid_password',
        attemptCountWindow: ipFailures,
        lockedUntil: locksAccount || locksIp ? new Date(Date.now() + LOCKOUT_WINDOW_MS) : null,
      });
      return res.status(401).json(genericError);
    }

    // Successful login clears only this IP's failures. Other IPs' locks and the account-wide count
    // must survive, or every sign-in by the owner would hand an attacker a fresh set of guesses.
    await models.InvalidLoginAttempt.destroy({
      where: { userId: user.id, ipAddress, failureReason: { [Op.ne]: ACCOUNT_LOCK_REASON } },
    });

    const loginAccess = isUserAllowedToLogin(user);
    if (!loginAccess.ok) {
      return res.status(403).json({
        ok: false,
        message: loginAccess.reason,
      });
    }

    const globalAccess = await effectiveRoleAccess(models, user, null);
    const isSuperuser = globalAccess.roleCodes.includes('superuser');

    let effectiveOrganizationId = null;
    let organizationName = '';
    let organizationLegalName = '';
    let organizationCurrency = 'USD';

    if (!isSuperuser) {
      const organizations = await listUserActiveOrganizations(models, user);
      if (organizations.length === 0) {
        return res.status(403).json({
          code: 'LICENSE_INACTIVE',
          message: 'No active organization membership found for this user.',
        });
      }

      const organizationIds = organizations.map((organization) => organization.id);
      const licenseMap = await mapOrganizationLicenseStatus(models, organizationIds, new Date());
      const selectableOrganizations = organizations.map((organization) => {
        const hasActiveLicense = licenseMap.has(organization.id);
        return {
          id: organization.id,
          name: organization.name || '',
          legalName: organization.legalName || '',
          currency: String(organization.currency || 'USD').toUpperCase().slice(0, 3) || 'USD',
          hasActiveLicense,
          licenseStatusReason: hasActiveLicense ? null : 'License missing, revoked, or expired.',
        };
      });

      const licensedOrganizations = selectableOrganizations.filter(
        (organization) => organization.hasActiveLicense
      );
      if (licensedOrganizations.length === 0) {
        return res.status(403).json({
          code: 'LICENSE_INACTIVE',
          message: 'None of your assigned organizations has an active license.',
        });
      }

      if (!requestedOrganizationId && licensedOrganizations.length > 1) {
        const suggestedOrganizationId = await resolveEffectiveOrganizationId(models, user);
        const suggestedLicensedOrganization = licensedOrganizations.find(
          (organization) => organization.id === suggestedOrganizationId
        );
        return res.status(409).json({
          ok: false,
          code: 'ORGANIZATION_SELECTION_REQUIRED',
          message: 'Select an organization to continue login.',
          data: {
            requiresOrganizationSelection: true,
            organizations: licensedOrganizations,
            suggestedOrganizationId:
              String(suggestedLicensedOrganization?.id || '').trim() || null,
          },
        });
      }

      const targetOrganizationId =
        requestedOrganizationId ||
        (licensedOrganizations.length === 1 ? licensedOrganizations[0].id : null) ||
        (await resolveEffectiveOrganizationId(models, user));

      const selectedOrganization = licensedOrganizations.find(
        (organization) => organization.id === targetOrganizationId
      );

      if (!selectedOrganization) {
        return res.status(403).json({
          code: 'ORGANIZATION_ACCESS_DENIED',
          message: 'Selected organization is invalid for this user.',
        });
      }

      if (!selectedOrganization.hasActiveLicense) {
        return res.status(403).json({
          code: 'LICENSE_INACTIVE',
          message: 'Selected organization has no active license.',
        });
      }

      effectiveOrganizationId = selectedOrganization.id;
      organizationName = String(selectedOrganization.name || '').trim();
      organizationLegalName = String(selectedOrganization.legalName || '').trim();
      organizationCurrency = selectedOrganization.currency;
    } else {
      effectiveOrganizationId = await resolveEffectiveOrganizationId(models, user);

      if (effectiveOrganizationId && models.Organization) {
        const organization = await models.Organization.findByPk(effectiveOrganizationId, {
          attributes: ['id', 'name', 'legalName', 'currency'],
        });
        organizationCurrency = String(organization?.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';
        organizationName = String(organization?.name || '').trim();
        organizationLegalName = String(organization?.legalName || '').trim();
      }
    }

    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await models.Token.create({
      userId: user.id,
      tokenHash,
      type: 'access',
      scope: 'user',
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
      metadata: {
        loginMethod: 'password',
        organizationId: effectiveOrganizationId || null,
      },
      isActive: true,
    });

    await user.update({
      lastLoginAt: new Date(),
    });

    const {roleCodes, permissions} = await effectiveRoleAccess(models, user, effectiveOrganizationId);
    const permissionCodes = Array.from(permissions);

    return res.status(200).json({
      ok: true,
      message: 'Login successful.',
      data: {
        accessToken: rawToken,
        tokenType: 'Bearer',
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageCdnUrl: user.profileImageCdnUrl,
          profileImageUrl: user.profileImageUrl,
          status: user.status,
          isEmailVerified: user.isEmailVerified,
          organizationId: effectiveOrganizationId,
          organizationName,
          organizationLegalName,
          currency: organizationCurrency,
          roleCodes,
          permissionCodes,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to process login request.',
    });
  }
}

async function getSession(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const models = getModels();
    if (!models || !models.Organization) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const authUser = req.auth?.user || {};
    const organizationId = authUser.organizationId || null;
    let organizationName = '';
    let organizationLegalName = '';
    let organizationCurrency = String(authUser.currency || 'USD').toUpperCase().slice(0, 3) || 'USD';

    if (organizationId) {
      const organization = await models.Organization.findByPk(organizationId, {
        attributes: ['id', 'name', 'legalName', 'currency'],
      });
      organizationName = String(organization?.name || '').trim();
      organizationLegalName = String(organization?.legalName || '').trim();
      organizationCurrency =
        String(organization?.currency || organizationCurrency || 'USD').toUpperCase().slice(0, 3) || 'USD';
    }

    return res.status(200).json({
      ok: true,
      message: 'Session resolved.',
      data: {
        expiresAt: req.auth.expiresAt,
        user: {
          id: authUser.id,
          email: authUser.email,
          firstName: authUser.firstName,
          lastName: authUser.lastName,
          profileImageCdnUrl: authUser.profileImageCdnUrl,
          profileImageUrl: authUser.profileImageUrl,
          status: authUser.status,
          isEmailVerified: authUser.isEmailVerified,
          organizationId,
          organizationName,
          organizationLegalName,
          currency: organizationCurrency,
          roleCodes: req.auth?.roleCodes || [],
          permissionCodes: Array.from(req.auth?.permissions || []),
        },
      },
    });
  } catch (err) {
    console.error('Get session error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to resolve session.',
    });
  }
}

function buildResetPasswordUrl(rawToken) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  const resetPath = String(process.env.RESET_PASSWORD_PATH || '/reset-password').trim();
  const safePath = resetPath.startsWith('/') ? resetPath : `/${resetPath}`;
  const separator = safePath.includes('?') ? '&' : '?';
  return `${appBaseUrl.replace(/\/+$/, '')}${safePath}${separator}token=${encodeURIComponent(rawToken)}`;
}

function buildVerifyEmailUrl(rawToken) {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  const verifyPath = String(process.env.VERIFY_EMAIL_PATH || '/verify-email').trim();
  const safePath = verifyPath.startsWith('/') ? verifyPath : `/${verifyPath}`;
  const separator = safePath.includes('?') ? '&' : '?';
  return `${appBaseUrl.replace(/\/+$/, '')}${safePath}${separator}token=${encodeURIComponent(rawToken)}`;
}

function isValidNewPassword(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  return hasUpper && hasLower && hasNumber;
}

async function forgotPassword(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const normalizedEmail = String(req.body?.email || '').toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(400).json({
        ok: false,
        message: 'email is required.',
      });
    }

    const genericMessage =
      'If an account exists for that email, a password reset link has been sent.';

    const user = await models.User.findOne({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      return res.status(200).json({
        ok: true,
        message: genericMessage,
      });
    }

    // Earlier links stay valid until they expire or one is used; revoking them here would let
    // anyone repeatedly invalidate a victim's email simply by requesting another one.
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresInMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await models.Token.create({
      userId: user.id,
      tokenHash,
      type: 'reset_password',
      scope: 'password_reset',
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
      metadata: {
        email: user.email,
      },
      isActive: true,
    });

    const resetUrl = buildResetPasswordUrl(rawToken);
    // Sent in the background so response time does not reveal whether the account exists
    sendPasswordResetEmail({
      toEmail: user.email,
      toName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
      resetUrl,
      expiresInMinutes,
    }).catch((err) => console.error('Password reset email error:', err));

    return res.status(200).json({
      ok: true,
      message: genericMessage,
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to process forgot password request.',
    });
  }
}

async function resetPassword(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!token) {
      return res.status(400).json({
        ok: false,
        message: 'token is required.',
      });
    }
    if (!newPassword) {
      return res.status(400).json({
        ok: false,
        message: 'newPassword is required.',
      });
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({
        ok: false,
        message: 'Password confirmation does not match.',
      });
    }
    if (!isValidNewPassword(newPassword)) {
      return res.status(400).json({
        ok: false,
        message:
          'Password must be at least 8 characters and include uppercase, lowercase, and a number.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenRecord = await models.Token.findOne({
      where: {
        tokenHash,
        type: 'reset_password',
        isActive: true,
        revokedAt: null,
      },
      include: [
        {
          model: models.User,
          as: 'user',
        },
      ],
    });

    if (!tokenRecord || !tokenRecord.user) {
      return res.status(400).json({
        ok: false,
        message: 'Reset token is invalid or expired.',
      });
    }

    if (new Date(tokenRecord.expiresAt) <= new Date()) {
      await tokenRecord.update({
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'expired',
      });
      return res.status(400).json({
        ok: false,
        message: 'Reset token is invalid or expired.',
      });
    }

    const user = tokenRecord.user;
    if (!user.isActive) {
      return res.status(403).json({
        ok: false,
        message: 'User is inactive.',
      });
    }

    const nextStatus = String(user.status || '').toLowerCase();
    const shouldActivate =
      nextStatus === 'pending_verification' || nextStatus === 'invited';
    await models.User.sequelize.transaction(async (transaction) => {
      await user.update(
        {
          password: newPassword,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          ...(shouldActivate ? { status: 'active' } : {}),
        },
        { transaction }
      );

      // Revoke the reset link and any existing sessions so the old password's sessions cannot linger
      await models.Token.update(
        {
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'password_reset_completed',
        },
        {
          where: {
            userId: user.id,
            type: ['reset_password', 'access', 'refresh'],
            isActive: true,
            revokedAt: null,
          },
          transaction,
        }
      );

      // Proving inbox ownership lifts any brute-force lockout, so the new password works immediately
      await models.InvalidLoginAttempt.destroy({ where: { userId: user.id }, transaction });
    });

    return res.status(200).json({
      ok: true,
      message: 'Password reset successful. You can now sign in.',
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to reset password.',
    });
  }
}

async function requestEmailVerification(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const normalizedEmail = String(req.body?.email || '').toLowerCase().trim();
    if (!normalizedEmail) {
      return res.status(400).json({
        ok: false,
        message: 'email is required.',
      });
    }

    const genericMessage =
      'If an account exists for that email, a verification link has been sent.';

    const user = await models.User.findOne({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive || user.isEmailVerified) {
      return res.status(200).json({
        ok: true,
        message: genericMessage,
      });
    }

    // Earlier links stay valid until they expire or one is used; revoking them here would let
    // anyone repeatedly invalidate a victim's email simply by requesting another one.
    const rawToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresInMinutes = Number(process.env.VERIFY_EMAIL_EXPIRES_MINUTES || 60);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await models.Token.create({
      userId: user.id,
      tokenHash,
      type: 'verify_email',
      scope: 'email_verification',
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
      metadata: {
        email: user.email,
      },
      isActive: true,
    });

    const verifyUrl = buildVerifyEmailUrl(rawToken);
    // Sent in the background so response time does not reveal whether the account exists
    sendEmailVerificationEmail({
      toEmail: user.email,
      toName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
      verifyUrl,
      expiresInMinutes,
    }).catch((err) => console.error('Verification email error:', err));

    return res.status(200).json({
      ok: true,
      message: genericMessage,
    });
  } catch (err) {
    console.error('Request email verification error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to process verification request.',
    });
  }
}

async function verifyEmail(req, res) {
  try {
    const models = getModels();
    if (!models) {
      return res.status(503).json({
        ok: false,
        message: 'Database models are not ready yet.',
      });
    }

    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({
        ok: false,
        message: 'token is required.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenRecord = await models.Token.findOne({
      where: {
        tokenHash,
        type: 'verify_email',
        isActive: true,
        revokedAt: null,
      },
      include: [
        {
          model: models.User,
          as: 'user',
        },
      ],
    });

    if (!tokenRecord || !tokenRecord.user) {
      return res.status(400).json({
        ok: false,
        message: 'Verification token is invalid or expired.',
      });
    }

    if (new Date(tokenRecord.expiresAt) <= new Date()) {
      await tokenRecord.update({
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'expired',
      });
      return res.status(400).json({
        ok: false,
        message: 'Verification token is invalid or expired.',
      });
    }

    const user = tokenRecord.user;
    await user.update({
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      status: user.status === 'pending_verification' ? 'active' : user.status,
    });

    await models.Token.update(
      {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: 'email_verified',
      },
      {
        where: {
          userId: user.id,
          type: 'verify_email',
          isActive: true,
          revokedAt: null,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      message: 'Email verified successfully. You can now sign in.',
    });
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({
      ok: false,
      message: 'Unable to verify email.',
    });
  }
}

module.exports = {
  login,
  getSession,
  forgotPassword,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
};
