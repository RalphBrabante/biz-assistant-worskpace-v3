'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('items', {
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
      type: {
        type: Sequelize.ENUM('product', 'service'),
        allowNull: false,
        defaultValue: 'product',
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
      category: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      unit: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'each',
      },
      price: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discounted_price: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: true,
      },
      currency: {
        type: Sequelize.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      stock: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      reorder_level: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      tax_rate: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('items', ['organization_id'], {
      name: 'items_organization_id',
    });
    await queryInterface.addIndex('items', ['type'], {
      name: 'items_type',
    });
    await queryInterface.addIndex('items', ['name'], {
      name: 'items_name',
    });
    await queryInterface.addIndex('items', ['sku'], {
      name: 'items_sku',
    });
    await queryInterface.addIndex('items', ['created_by'], {
      name: 'items_created_by',
    });
    await queryInterface.addIndex('items', ['updated_by'], {
      name: 'items_updated_by',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('items');
  },
};
