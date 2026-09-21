'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_organizations', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      vendor_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'vendors',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'organizations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      is_owner: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('vendor_organizations', ['vendor_id'], {
      name: 'vendor_organizations_vendor_id',
    });
    await queryInterface.addIndex('vendor_organizations', ['organization_id'], {
      name: 'vendor_organizations_organization_id',
    });
    await queryInterface.addIndex('vendor_organizations', ['is_owner'], {
      name: 'vendor_organizations_is_owner',
    });
    await queryInterface.addIndex('vendor_organizations', ['vendor_id', 'organization_id'], {
      name: 'vendor_organizations_vendor_id_organization_id_unique',
      unique: true,
    });

    await queryInterface.sequelize.query(`
      INSERT INTO vendor_organizations (
        id, vendor_id, organization_id, is_owner, created_by, updated_by, created_at, updated_at
      )
      SELECT
        UUID(), id, organization_id, true, created_by, updated_by, NOW(), NOW()
      FROM vendors
      WHERE organization_id IS NOT NULL
      ON DUPLICATE KEY UPDATE
        is_owner = VALUES(is_owner),
        updated_at = VALUES(updated_at)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendor_organizations');
  },
};
