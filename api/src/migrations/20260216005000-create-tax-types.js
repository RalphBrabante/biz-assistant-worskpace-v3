'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tax_types', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      code: {
        type: Sequelize.STRING(30),
        allowNull: false,
        unique: true,
      },
      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
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

    await queryInterface.addIndex('tax_types', ['code'], {
      name: 'tax_types_code_uq',
      unique: true,
    });
    await queryInterface.addIndex('tax_types', ['name'], {
      name: 'tax_types_name',
    });
    await queryInterface.addIndex('tax_types', ['is_active'], {
      name: 'tax_types_is_active',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tax_types');
  },
};
