'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
          INSERT INTO vendor_organizations (
            id,
            vendor_id,
            organization_id,
            is_owner,
            created_by,
            updated_by,
            created_at,
            updated_at
          )
          SELECT
            UUID(),
            v.id,
            v.organization_id,
            true,
            v.created_by,
            v.updated_by,
            COALESCE(v.created_at, NOW()),
            NOW()
          FROM vendors v
          LEFT JOIN vendor_organizations vo
            ON vo.vendor_id = v.id
           AND vo.organization_id = v.organization_id
          WHERE v.organization_id IS NOT NULL
            AND vo.id IS NULL
        `,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
          UPDATE vendor_organizations vo
          INNER JOIN vendors v
            ON v.id = vo.vendor_id
           AND v.organization_id = vo.organization_id
          SET
            vo.is_owner = true,
            vo.updated_at = NOW()
          WHERE vo.is_owner = false
            AND v.organization_id IS NOT NULL
        `,
        { transaction }
      );
    });
  },

  async down() {
    // Data backfill is intentionally not reversed; removing relationship rows can break existing vendor access.
  },
};
