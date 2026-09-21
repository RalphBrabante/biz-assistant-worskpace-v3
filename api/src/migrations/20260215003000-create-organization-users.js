'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('organization_users', {
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
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'member',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('organization_users', ['organization_id'], {
      name: 'organization_users_organization_id',
    });
    await queryInterface.addIndex('organization_users', ['user_id'], {
      name: 'organization_users_user_id',
    });
    await queryInterface.addIndex(
      'organization_users',
      ['organization_id', 'user_id'],
      {
        name: 'organization_users_organization_id_user_id',
        unique: true,
      }
    );

    await queryInterface.sequelize.query(`
      INSERT INTO organization_users (
        id, organization_id, user_id, role, is_active, created_at, updated_at
      )
      SELECT
        UUID(), organization_id, id, role, is_active, NOW(), NOW()
      FROM users
      WHERE organization_id IS NOT NULL
      ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organization_users');
  },
};
