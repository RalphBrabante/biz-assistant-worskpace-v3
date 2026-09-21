'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_item_snapshots', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
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
      item_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'items',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sku: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      name: {
        type: Sequelize.STRING(180),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      type: {
        type: Sequelize.ENUM('product', 'service'),
        allowNull: false,
        defaultValue: 'product',
      },
      unit: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'each',
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      unit_price: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discounted_unit_price: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      tax_rate: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      quantity: {
        type: Sequelize.DECIMAL(12, 3),
        allowNull: false,
        defaultValue: 1.0,
      },
      line_subtotal: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      line_discount: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      line_tax: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      line_total: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      metadata: {
        type: Sequelize.JSON,
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

    await queryInterface.addIndex('order_item_snapshots', ['order_id'], {
      name: 'order_item_snapshots_order_id',
    });
    await queryInterface.addIndex('order_item_snapshots', ['item_id'], {
      name: 'order_item_snapshots_item_id',
    });
    await queryInterface.addIndex('order_item_snapshots', ['name'], {
      name: 'order_item_snapshots_name',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_item_snapshots');
  },
};
