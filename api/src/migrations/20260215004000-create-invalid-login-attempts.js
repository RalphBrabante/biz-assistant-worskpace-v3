'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('invalid_login_attempts', {
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
      attempted_email: {
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
      failure_reason: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      attempt_count_window: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      },
      locked_until: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('invalid_login_attempts', ['user_id'], {
      name: 'invalid_login_attempts_user_id',
    });
    await queryInterface.addIndex('invalid_login_attempts', ['attempted_email'], {
      name: 'invalid_login_attempts_attempted_email',
    });
    await queryInterface.addIndex('invalid_login_attempts', ['created_at'], {
      name: 'invalid_login_attempts_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('invalid_login_attempts');
  },
};
