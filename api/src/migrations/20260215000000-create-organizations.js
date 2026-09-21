'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('organizations', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      legal_name: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      tax_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      address_line1: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      address_line2: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      state: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      postal_code: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(100),
        allowNull: false,
        defaultValue: 'United States',
      },
      contact_email: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      website: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      contact_name: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      industry: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      employee_count: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
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

    const existingIndexes = await queryInterface.showIndex('organizations');
    const hasNameIndex = existingIndexes.some(
      (idx) => idx.name === 'organizations_name'
    );
    const hasContactEmailIndex = existingIndexes.some(
      (idx) => idx.name === 'organizations_contact_email'
    );

    if (!hasNameIndex) {
      await queryInterface.addIndex('organizations', ['name'], {
        name: 'organizations_name',
      });
    }

    if (!hasContactEmailIndex) {
      await queryInterface.addIndex('organizations', ['contact_email'], {
        name: 'organizations_contact_email',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organizations');
  },
};
