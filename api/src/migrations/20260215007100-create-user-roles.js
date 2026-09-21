'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_roles', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
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
      assigned_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      assigned_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
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

    await queryInterface.addIndex('user_roles', ['user_id'], {
      name: 'user_roles_user_id',
    });

    await queryInterface.addIndex('user_roles', ['role_id'], {
      name: 'user_roles_role_id',
    });

    await queryInterface.addIndex('user_roles', ['user_id', 'role_id'], {
      name: 'user_roles_user_id_role_id',
      unique: true,
    });

    await queryInterface.sequelize.query(`
      INSERT INTO roles (id, name, code, description, is_system, is_active, created_at, updated_at)
      SELECT UUID(), role, LOWER(REPLACE(role, ' ', '_')), CONCAT('Auto-migrated role: ', role), true, true, NOW(), NOW()
      FROM users
      WHERE role IS NOT NULL AND TRIM(role) <> ''
      GROUP BY role
      ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO user_roles (id, user_id, role_id, assigned_at, is_active, created_at, updated_at)
      SELECT UUID(), u.id, r.id, NOW(), true, NOW(), NOW()
      FROM users u
      INNER JOIN roles r ON r.name = u.role
      WHERE u.role IS NOT NULL AND TRIM(u.role) <> ''
      ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_roles');
  },
};
