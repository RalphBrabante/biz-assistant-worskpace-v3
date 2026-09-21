'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('licenses', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
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
      key: {
        type: Sequelize.STRING(120),
        allowNull: false,
        unique: true,
      },
      plan_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('active', 'expired', 'revoked', 'suspended'),
        allowNull: false,
        defaultValue: 'active',
      },
      starts_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      max_users: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    const existingIndexes = await queryInterface.showIndex('licenses');
    const hasOrgIndex = existingIndexes.some(
      (idx) => idx.name === 'licenses_organization_id'
    );
    const hasExpiryIndex = existingIndexes.some(
      (idx) => idx.name === 'licenses_expires_at'
    );
    const hasKeyIndex = existingIndexes.some(
      (idx) => idx.name === 'licenses_key'
    );

    if (!hasOrgIndex) {
      await queryInterface.addIndex('licenses', ['organization_id'], {
        name: 'licenses_organization_id',
      });
    }

    if (!hasExpiryIndex) {
      await queryInterface.addIndex('licenses', ['expires_at'], {
        name: 'licenses_expires_at',
      });
    }

    if (!hasKeyIndex) {
      await queryInterface.addIndex('licenses', ['key'], {
        name: 'licenses_key',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('licenses');
  },
};
