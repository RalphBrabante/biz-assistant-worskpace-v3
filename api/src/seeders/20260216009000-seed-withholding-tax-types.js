'use strict';

const crypto = require('crypto');

function deterministicUuid(input) {
  const hex = crypto.createHash('sha1').update(input).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const [organizations] = await queryInterface.sequelize.query('SELECT id FROM organizations');
    if (!Array.isArray(organizations) || organizations.length === 0) {
      return;
    }

    const now = new Date();
    const rows = [];
    for (const organization of organizations) {
      const organizationId = String(organization.id);
      rows.push(
        {
          id: deterministicUuid(`${organizationId}:WHT_GOODS_1`),
          organization_id: organizationId,
          code: 'WHT_GOODS_1',
          name: 'Supplier of goods',
          description: 'Supplier of goods withholding tax',
          percentage: 1.0,
          applies_to: 'expense',
          minimum_base_amount: 0.0,
          is_system: true,
          is_active: true,
          created_by: null,
          updated_by: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: deterministicUuid(`${organizationId}:WHT_SERVICES_2`),
          organization_id: organizationId,
          code: 'WHT_SERVICES_2',
          name: 'Supplier of services',
          description: 'Supplier of services withholding tax',
          percentage: 2.0,
          applies_to: 'expense',
          minimum_base_amount: 0.0,
          is_system: true,
          is_active: true,
          created_by: null,
          updated_by: null,
          created_at: now,
          updated_at: now,
        }
      );
    }

    for (const row of rows) {
      await queryInterface.sequelize.query(
        `
        INSERT INTO withholding_tax_types (
          id, organization_id, code, name, description, percentage, applies_to,
          minimum_base_amount, is_system, is_active, created_by, updated_by, created_at, updated_at
        ) VALUES (
          :id, :organizationId, :code, :name, :description, :percentage, :appliesTo,
          :minimumBaseAmount, :isSystem, :isActive, :createdBy, :updatedBy, :createdAt, :updatedAt
        )
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          description = VALUES(description),
          percentage = VALUES(percentage),
          applies_to = VALUES(applies_to),
          minimum_base_amount = VALUES(minimum_base_amount),
          is_system = VALUES(is_system),
          is_active = VALUES(is_active),
          updated_by = VALUES(updated_by),
          updated_at = VALUES(updated_at)
      `,
        {
          replacements: {
            id: row.id,
            organizationId: row.organization_id,
            code: row.code,
            name: row.name,
            description: row.description,
            percentage: row.percentage,
            appliesTo: row.applies_to,
            minimumBaseAmount: row.minimum_base_amount,
            isSystem: row.is_system,
            isActive: row.is_active,
            createdBy: row.created_by,
            updatedBy: row.updated_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('withholding_tax_types', {
      code: ['WHT_GOODS_1', 'WHT_SERVICES_2'],
    });
  },
};
