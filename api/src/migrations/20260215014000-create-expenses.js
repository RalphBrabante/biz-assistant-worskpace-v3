'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('expenses', {
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
      vendor_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'vendors',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      vendor_tax_id: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      expense_number: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      category: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      expense_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('draft', 'submitted', 'approved', 'paid', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      payment_method: {
        type: Sequelize.ENUM('cash', 'bank_transfer', 'credit_card', 'check', 'other'),
        allowNull: false,
        defaultValue: 'bank_transfer',
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      tax_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discount_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      receipt_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      paid_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      approved_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('expenses', ['organization_id', 'expense_number'], {
      name: 'expenses_organization_id_expense_number_uq',
      unique: true,
    });
    await queryInterface.addIndex('expenses', ['organization_id'], {
      name: 'expenses_organization_id',
    });
    await queryInterface.addIndex('expenses', ['vendor_id'], {
      name: 'expenses_vendor_id',
    });
    await queryInterface.addIndex('expenses', ['vendor_tax_id'], {
      name: 'expenses_vendor_tax_id',
    });
    await queryInterface.addIndex('expenses', ['status'], {
      name: 'expenses_status',
    });
    await queryInterface.addIndex('expenses', ['expense_date'], {
      name: 'expenses_expense_date',
    });
    await queryInterface.addIndex('expenses', ['due_date'], {
      name: 'expenses_due_date',
    });
    await queryInterface.addIndex('expenses', ['approved_by'], {
      name: 'expenses_approved_by',
    });
    await queryInterface.addIndex('expenses', ['created_by'], {
      name: 'expenses_created_by',
    });
    await queryInterface.addIndex('expenses', ['updated_by'], {
      name: 'expenses_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('expenses');
  },
};
