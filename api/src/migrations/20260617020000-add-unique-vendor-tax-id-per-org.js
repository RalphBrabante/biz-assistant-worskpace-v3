'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Nullify tax_id on newer duplicates (keep the one with the smallest id per org+tax_id).
    await queryInterface.sequelize.query(`
      UPDATE vendors SET tax_id = NULL
      WHERE id IN (
        SELECT id FROM (
          SELECT v.id
          FROM vendors v
          INNER JOIN (
            SELECT organization_id, tax_id, MIN(id) AS keep_id
            FROM vendors
            WHERE tax_id IS NOT NULL AND tax_id != ''
            GROUP BY organization_id, tax_id
            HAVING COUNT(*) > 1
          ) dup ON v.organization_id = dup.organization_id
               AND v.tax_id = dup.tax_id
               AND v.id != dup.keep_id
        ) AS to_clear
      )
    `);

    await queryInterface.addIndex('vendors', ['organization_id', 'tax_id'], {
      unique: true,
      name: 'vendors_organization_id_tax_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('vendors', 'vendors_organization_id_tax_id_unique');
  },
};
