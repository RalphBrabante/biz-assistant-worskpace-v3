'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('messages', {
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
      entity_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      metadata: {
        type: Sequelize.JSON,
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
      is_read: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      read_at: {
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

    await queryInterface.addIndex('messages', ['organization_id'], {
      name: 'messages_organization_id',
    });
    await queryInterface.addIndex('messages', ['entity_type'], {
      name: 'messages_entity_type',
    });
    await queryInterface.addIndex('messages', ['entity_id'], {
      name: 'messages_entity_id',
    });
    await queryInterface.addIndex('messages', ['created_by'], {
      name: 'messages_created_by',
    });
    await queryInterface.addIndex('messages', ['is_read'], {
      name: 'messages_is_read',
    });
    await queryInterface.addIndex('messages', ['created_at'], {
      name: 'messages_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('messages');
  },
};

