'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('purchase_orders', {
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
      po_number: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      vendor_name: {
        type: Sequelize.STRING(180),
        allowNull: false,
      },
      vendor_email: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      vendor_phone: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      billing_address: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      shipping_address: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      order_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      expected_delivery_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM(
          'draft',
          'submitted',
          'approved',
          'partially_received',
          'received',
          'cancelled'
        ),
        allowNull: false,
        defaultValue: 'draft',
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
      shipping_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      total_amount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      payment_terms: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
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
      approved_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('purchase_orders', ['organization_id'], {
      name: 'purchase_orders_organization_id',
    });
    await queryInterface.addIndex('purchase_orders', ['organization_id', 'po_number'], {
      name: 'purchase_orders_organization_id_po_number_uq',
      unique: true,
    });
    await queryInterface.addIndex('purchase_orders', ['status'], {
      name: 'purchase_orders_status',
    });
    await queryInterface.addIndex('purchase_orders', ['order_date'], {
      name: 'purchase_orders_order_date',
    });
    await queryInterface.addIndex('purchase_orders', ['created_by'], {
      name: 'purchase_orders_created_by',
    });
    await queryInterface.addIndex('purchase_orders', ['updated_by'], {
      name: 'purchase_orders_updated_by',
    });
    await queryInterface.addIndex('purchase_orders', ['approved_by'], {
      name: 'purchase_orders_approved_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('purchase_orders');
  },
};
