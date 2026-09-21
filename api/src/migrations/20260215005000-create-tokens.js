'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tokens', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      token_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      type: {
        type: Sequelize.ENUM('access', 'refresh', 'reset_password', 'verify_email', 'api_key'),
        allowNull: false,
        defaultValue: 'access',
      },
      scope: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      revoked_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      revoked_reason: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
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

    await queryInterface.addIndex('tokens', ['user_id'], {
      name: 'tokens_user_id',
    });
    await queryInterface.addIndex('tokens', ['token_hash'], {
      name: 'tokens_token_hash',
      unique: true,
    });
    await queryInterface.addIndex('tokens', ['type'], {
      name: 'tokens_type',
    });
    await queryInterface.addIndex('tokens', ['expires_at'], {
      name: 'tokens_expires_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tokens');
  },
};
