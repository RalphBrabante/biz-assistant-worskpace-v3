const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

async function organizationHasActiveLicense(organizationId, now = new Date()) {
  const models = getModels();
  if (!models || !models.License) {
    throw new Error('Models are not initialized');
  }

  const license = await models.License.findOne({
    where: {
      organizationId,
      isActive: true,
      status: 'active',
      expiresAt: { [Op.gte]: now },
      revokedAt: null,
    },
    order: [['expiresAt', 'DESC']],
  });

  return Boolean(license);
}

async function userHasAccess(userId, now = new Date()) {
  const models = getModels();
  if (!models || !models.User || !models.Organization || !models.OrganizationUser) {
    throw new Error('Models are not initialized');
  }

  const user = await models.User.findByPk(userId, {
    attributes: ['id', 'organizationId', 'isActive'],
  });

  if (!user || !user.isActive) {
    return false;
  }

  const memberships = await models.OrganizationUser.findAll({
    where: {
      userId: user.id,
      isActive: true,
    },
    attributes: ['organizationId'],
  });

  const membershipOrganizationIds = memberships.map((m) => m.organizationId);
  if (user.organizationId && !membershipOrganizationIds.includes(user.organizationId)) {
    membershipOrganizationIds.push(user.organizationId);
  }

  if (membershipOrganizationIds.length === 0) {
    return false;
  }

  const organizations = await models.Organization.findAll({
    where: {
      id: membershipOrganizationIds,
      isActive: true,
    },
    attributes: ['id'],
  });

  for (const organization of organizations) {
    if (await organizationHasActiveLicense(organization.id, now)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  organizationHasActiveLicense,
  userHasAccess,
};
