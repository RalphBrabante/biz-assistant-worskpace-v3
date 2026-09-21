'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('orders', {
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
      order_number: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      source: {
        type: Sequelize.ENUM('web', 'mobile', 'in_store', 'admin', 'api'),
        allowNull: false,
        defaultValue: 'web',
      },
      status: {
        type: Sequelize.ENUM(
          'draft',
          'pending',
          'confirmed',
          'processing',
          'completed',
          'cancelled',
          'refunded'
        ),
        allowNull: false,
        defaultValue: 'pending',
      },
      payment_status: {
        type: Sequelize.ENUM('unpaid', 'partially_paid', 'paid', 'refunded', 'failed'),
        allowNull: false,
        defaultValue: 'unpaid',
      },
      fulfillment_status: {
        type: Sequelize.ENUM('unfulfilled', 'partially_fulfilled', 'fulfilled'),
        allowNull: false,
        defaultValue: 'unfulfilled',
      },
      order_date: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
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
      billing_address: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      shipping_address: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('orders', ['organization_id'], {
      name: 'orders_organization_id',
    });
    await queryInterface.addIndex('orders', ['organization_id', 'order_number'], {
      name: 'orders_organization_id_order_number_uq',
      unique: true,
    });
    await queryInterface.addIndex('orders', ['user_id'], {
      name: 'orders_user_id',
    });
    await queryInterface.addIndex('orders', ['status'], {
      name: 'orders_status',
    });
    await queryInterface.addIndex('orders', ['payment_status'], {
      name: 'orders_payment_status',
    });
    await queryInterface.addIndex('orders', ['fulfillment_status'], {
      name: 'orders_fulfillment_status',
    });
    await queryInterface.addIndex('orders', ['order_date'], {
      name: 'orders_order_date',
    });
    await queryInterface.addIndex('orders', ['created_by'], {
      name: 'orders_created_by',
    });
    await queryInterface.addIndex('orders', ['updated_by'], {
      name: 'orders_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('orders');
  },
};
