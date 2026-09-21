'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sales_invoices', {
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
      order_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'orders',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      invoice_number: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      issue_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('draft', 'issued', 'sent', 'paid', 'partially_paid', 'overdue', 'void'),
        allowNull: false,
        defaultValue: 'draft',
      },
      payment_status: {
        type: Sequelize.ENUM('unpaid', 'partially_paid', 'paid', 'refunded', 'failed'),
        allowNull: false,
        defaultValue: 'unpaid',
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      subtotal_amount: {
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
      paid_at: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.addIndex('sales_invoices', ['order_id'], {
      name: 'sales_invoices_order_id_uq',
      unique: true,
    });
    await queryInterface.addIndex('sales_invoices', ['organization_id', 'invoice_number'], {
      name: 'sales_invoices_organization_id_invoice_number_uq',
      unique: true,
    });
    await queryInterface.addIndex('sales_invoices', ['organization_id'], {
      name: 'sales_invoices_organization_id',
    });
    await queryInterface.addIndex('sales_invoices', ['status'], {
      name: 'sales_invoices_status',
    });
    await queryInterface.addIndex('sales_invoices', ['payment_status'], {
      name: 'sales_invoices_payment_status',
    });
    await queryInterface.addIndex('sales_invoices', ['issue_date'], {
      name: 'sales_invoices_issue_date',
    });
    await queryInterface.addIndex('sales_invoices', ['due_date'], {
      name: 'sales_invoices_due_date',
    });
    await queryInterface.addIndex('sales_invoices', ['created_by'], {
      name: 'sales_invoices_created_by',
    });
    await queryInterface.addIndex('sales_invoices', ['updated_by'], {
      name: 'sales_invoices_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sales_invoices');
  },
};
