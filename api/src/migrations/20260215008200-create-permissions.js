'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('permissions', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      code: {
        type: Sequelize.STRING(150),
        allowNull: false,
        unique: true,
      },
      resource: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      is_system: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('permissions', ['code'], {
      name: 'permissions_code',
      unique: true,
    });
    await queryInterface.addIndex('permissions', ['resource'], {
      name: 'permissions_resource',
    });
    await queryInterface.addIndex('permissions', ['action'], {
      name: 'permissions_action',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('permissions');
  },
};
