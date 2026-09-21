'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
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
      first_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      password: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      phone: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      address_line1: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      address_line2: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: true,
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
        allowNull: true,
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
      last_login_at: {
        type: Sequelize.DATE,
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

    const existingIndexes = await queryInterface.showIndex('users');
    const hasOrganizationIndex = existingIndexes.some(
      (idx) => idx.name === 'users_organization_id'
    );
    const hasEmailIndex = existingIndexes.some(
      (idx) => idx.name === 'users_email'
    );

    if (!hasOrganizationIndex) {
      await queryInterface.addIndex('users', ['organization_id'], {
        name: 'users_organization_id',
      });
    }

    if (!hasEmailIndex) {
      await queryInterface.addIndex('users', ['email'], {
        name: 'users_email',
        unique: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
