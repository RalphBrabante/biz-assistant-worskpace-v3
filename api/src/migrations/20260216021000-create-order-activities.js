'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('order_activities', {
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
      action_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      changed_fields: {
        type: Sequelize.JSON,
        allowNull: true,
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

    await queryInterface.addIndex('order_activities', ['order_id'], {
      name: 'order_activities_order_id',
    });
    await queryInterface.addIndex('order_activities', ['organization_id'], {
      name: 'order_activities_organization_id',
    });
    await queryInterface.addIndex('order_activities', ['user_id'], {
      name: 'order_activities_user_id',
    });
    await queryInterface.addIndex('order_activities', ['action_type'], {
      name: 'order_activities_action_type',
    });
    await queryInterface.addIndex('order_activities', ['created_at'], {
      name: 'order_activities_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_activities');
  },
};
