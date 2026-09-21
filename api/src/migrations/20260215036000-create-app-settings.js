'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('app_settings', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      key: {
        type: Sequelize.STRING(120),
        allowNull: false,
        unique: true,
      },
      value_boolean: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      value_text: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.addIndex('app_settings', ['key'], {
      name: 'app_settings_key_uq',
      unique: true,
    });
    await queryInterface.addIndex('app_settings', ['updated_by'], {
      name: 'app_settings_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('app_settings');
  },
};
