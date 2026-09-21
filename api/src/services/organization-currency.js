const { getModels } = require('../sequelize');

async function getOrganizationCurrency(organizationId, fallback = 'USD') {
  if (!organizationId) {
    return fallback;
  }

  const models = getModels();
  if (!models || !models.Organization) {
    return fallback;
  }

  const organization = await models.Organization.findByPk(organizationId, {
    attributes: ['id', 'currency'],
  });

  const value = String(organization?.currency || fallback).toUpperCase().slice(0, 3);
  return value || fallback;
}

module.exports = {
  getOrganizationCurrency,
};
