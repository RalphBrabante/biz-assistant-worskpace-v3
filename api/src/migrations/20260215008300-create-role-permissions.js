'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('role_permissions', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      role_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'roles',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      permission_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'permissions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      is_allowed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      scope: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      constraints: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      assigned_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      assigned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
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

    await queryInterface.addIndex('role_permissions', ['role_id'], {
      name: 'role_permissions_role_id',
    });
    await queryInterface.addIndex('role_permissions', ['permission_id'], {
      name: 'role_permissions_permission_id',
    });
    await queryInterface.addIndex('role_permissions', ['assigned_by_user_id'], {
      name: 'role_permissions_assigned_by_user_id',
    });
    await queryInterface.addIndex('role_permissions', ['role_id', 'permission_id'], {
      name: 'role_permissions_role_id_permission_id',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('role_permissions');
  },
};
