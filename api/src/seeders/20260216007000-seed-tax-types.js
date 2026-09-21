'use strict';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const rows = [
      {
        id: 'aa111111-1111-4111-8111-111111111111',
        code: 'VAT',
        name: 'Value Added Tax',
        description: 'Standard Value Added Tax',
        percentage: 12.0,
        is_system: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'bb222222-2222-4222-8222-222222222222',
        code: 'PT',
        name: 'Percentage Tax',
        description: 'Percentage Tax',
        percentage: 3.0,
        is_system: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ];

    for (const row of rows) {
      await queryInterface.sequelize.query(
        `
        INSERT INTO tax_types (
          id, code, name, description, percentage, is_system, is_active, created_at, updated_at
        ) VALUES (
          :id, :code, :name, :description, :percentage, :isSystem, :isActive, :createdAt, :updatedAt
        )
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          description = VALUES(description),
          percentage = VALUES(percentage),
          is_system = VALUES(is_system),
          is_active = VALUES(is_active),
          updated_at = VALUES(updated_at)
      `,
        {
          replacements: {
            id: row.id,
            code: row.code,
            name: row.name,
            description: row.description,
            percentage: row.percentage,
            isSystem: row.is_system,
            isActive: row.is_active,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('tax_types', {
      code: ['VAT', 'PT'],
    });
  },
};
