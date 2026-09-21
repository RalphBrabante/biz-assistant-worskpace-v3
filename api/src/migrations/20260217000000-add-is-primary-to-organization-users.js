'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organization_users', 'is_primary', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'is_active',
    });

    await queryInterface.addIndex('organization_users', ['user_id', 'is_primary'], {
      name: 'organization_users_user_id_is_primary_idx',
    });

    // Prefer the legacy users.organization_id as primary when available.
    await queryInterface.sequelize.query(`
      UPDATE organization_users ou
      INNER JOIN users u ON u.id = ou.user_id
      SET ou.is_primary = 1
      WHERE u.organization_id IS NOT NULL
        AND ou.organization_id = u.organization_id
    `);

    // For users without a primary yet, pick one membership deterministically.
    await queryInterface.sequelize.query(`
      UPDATE organization_users ou
      INNER JOIN (
        SELECT candidate.user_id, MIN(candidate.id) AS min_id
        FROM organization_users candidate
        LEFT JOIN organization_users primary_row
          ON primary_row.user_id = candidate.user_id
         AND primary_row.is_primary = 1
        WHERE primary_row.id IS NULL
        GROUP BY candidate.user_id
      ) missing ON missing.min_id = ou.id
      SET ou.is_primary = 1
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('organization_users', 'organization_users_user_id_is_primary_idx');
    await queryInterface.removeColumn('organization_users', 'is_primary');
  },
};

