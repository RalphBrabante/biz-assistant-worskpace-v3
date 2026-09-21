'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('customers', {
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
      customer_code: {
        type: Sequelize.STRING(60),
        allowNull: true,
      },
      type: {
        type: Sequelize.ENUM('individual', 'business'),
        allowNull: false,
        defaultValue: 'business',
      },
      name: {
        type: Sequelize.STRING(180),
        allowNull: false,
      },
      legal_name: {
        type: Sequelize.STRING(180),
        allowNull: true,
      },
      tax_id: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      contact_person: {
        type: Sequelize.STRING(140),
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      mobile: {
        type: Sequelize.STRING(40),
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
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      state: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      postal_code: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      credit_limit: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
      },
      payment_terms_days: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'blocked'),
        allowNull: false,
        defaultValue: 'active',
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.addIndex('customers', ['organization_id'], {
      name: 'customers_organization_id',
    });
    await queryInterface.addIndex('customers', ['name'], {
      name: 'customers_name',
    });
    await queryInterface.addIndex('customers', ['tax_id'], {
      name: 'customers_tax_id',
    });
    await queryInterface.addIndex('customers', ['email'], {
      name: 'customers_email',
    });
    await queryInterface.addIndex('customers', ['status'], {
      name: 'customers_status',
    });
    await queryInterface.addIndex('customers', ['customer_code'], {
      name: 'customers_customer_code',
    });
    await queryInterface.addIndex('customers', ['organization_id', 'tax_id'], {
      name: 'customers_organization_id_tax_id',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('customers');
  },
};
