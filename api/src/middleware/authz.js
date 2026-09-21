const crypto = require('crypto');
const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

function extractBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

function isPublicApiPath(req) {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.path || '').trim();
  if (
    method === 'GET' &&
    (path === '/settings/storage/google-drive/callback'
      || path === '/api/v1/settings/storage/google-drive/callback')
  ) {
    return true;
  }
  return false;
}

function hasPrivilegedRole(roleCodes) {
  const normalized = roleCodes.map((code) => String(code || '').toLowerCase());
  return normalized.includes('superuser') || normalized.includes('administrator');
}

function hasSuperuserRole(roleCodes) {
  const normalized = roleCodes.map((code) => String(code || '').toLowerCase());
  return normalized.includes('superuser');
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

async function authenticateRequest(req, res, next) {
  try {
    if (isPublicApiPath(req)) {
      return next();
    }

    const models = getModels();
    if (!models || !models.Token || !models.User || !models.Role || !models.Permission || !models.License) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service is not ready.',
      });
    }

    const rawToken = extractBearerToken(req);
    if (!rawToken) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token.',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const tokenRecord = await models.Token.findOne({
      where: {
        tokenHash,
        isActive: true,
        revokedAt: null,
      },
      include: [
        {
          model: models.User,
          as: 'user',
          include: [
            {
              model: models.Role,
              as: 'roles',
              through: { attributes: [] },
              include: [
                {
                  model: models.Permission,
                  as: 'permissions',
                  through: { attributes: [] },
                },
              ],
            },
          ],
        },
      ],
    });

    if (!tokenRecord) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Invalid access token.',
      });
    }

    if (new Date(tokenRecord.expiresAt) <= new Date()) {
      // Remove expired token rows so stale access tokens do not accumulate.
      await tokenRecord.destroy();
      return res.status(401).json({
        code: 'TOKEN_EXPIRED',
        message: 'Access token has expired.',
      });
    }

    const user = tokenRecord.user;
    if (!user || !user.isActive) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'User is inactive or unavailable.',
      });
    }

    const roles = (user.roles || []).map((role) => role.code);
    const isSuperuser = hasSuperuserRole(roles);
    const tokenOrganizationId = String(tokenRecord?.metadata?.organizationId || '').trim();
    let effectiveOrganizationId = tokenOrganizationId || (await resolveEffectiveOrganizationId(models, user));

    if (!isSuperuser && tokenOrganizationId) {
      const hasMembership = await userHasActiveOrganizationMembership(
        models,
        user.id,
        tokenOrganizationId
      );
      if (!hasMembership && user.organizationId !== tokenOrganizationId) {
        return res.status(401).json({
          code: 'UNAUTHORIZED',
          message: 'Token organization scope is no longer valid for this user.',
        });
      }
      effectiveOrganizationId = tokenOrganizationId;
    }

    // Enforce organization license access for all non-superuser users.
    if (!isSuperuser) {
      const organizationId = effectiveOrganizationId;
      if (!organizationId) {
        return res.status(403).json({
          code: 'LICENSE_INACTIVE',
          message: 'Organization has no active license.',
        });
      }

      const now = new Date();
      const activeLicense = await models.License.findOne({
        where: {
          organizationId,
          isActive: true,
          status: 'active',
          revokedAt: null,
          expiresAt: { [Op.gte]: now },
        },
        order: [['expiresAt', 'DESC']],
      });

      if (!activeLicense) {
        return res.status(403).json({
          code: 'LICENSE_INACTIVE',
          message: 'Organization license is missing, revoked, or expired.',
        });
      }
    }

    const permissions = new Set();
    for (const role of user.roles || []) {
      for (const permission of role.permissions || []) {
        permissions.add(String(permission.code || '').toLowerCase());
      }
    }

    req.auth = {
      tokenId: tokenRecord.id,
      userId: user.id,
      user: {
        ...user.toJSON(),
        organizationId: effectiveOrganizationId,
      },
      roleCodes: roles.map((r) => String(r || '').toLowerCase()),
      permissions,
      isPrivileged: hasPrivilegedRole(roles),
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

function authorize(requiredPermissions = []) {
  const required = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    if (req.auth.isPrivileged) {
      return next();
    }

    if (required.length === 0) {
      return next();
    }

    const hasAny = required.some((permissionCode) =>
      req.auth.permissions.has(String(permissionCode || '').toLowerCase())
    );

    if (!hasAny) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this endpoint.',
      });
    }

    return next();
  };
}

module.exports = {
  authenticateRequest,
  authorize,
};
