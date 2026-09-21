'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendors', {
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
      name: {
        type: Sequelize.STRING(180),
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
      contact_person: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      contact_email: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(50),
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
      payment_terms: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'blocked'),
        allowNull: false,
        defaultValue: 'active',
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

    await queryInterface.addIndex('vendors', ['organization_id'], {
      name: 'vendors_organization_id',
    });
    await queryInterface.addIndex('vendors', ['name'], {
      name: 'vendors_name',
    });
    await queryInterface.addIndex('vendors', ['contact_email'], {
      name: 'vendors_contact_email',
    });
    await queryInterface.addIndex('vendors', ['status'], {
      name: 'vendors_status',
    });
    await queryInterface.addIndex('vendors', ['created_by'], {
      name: 'vendors_created_by',
    });
    await queryInterface.addIndex('vendors', ['updated_by'], {
      name: 'vendors_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendors');
  },
};
