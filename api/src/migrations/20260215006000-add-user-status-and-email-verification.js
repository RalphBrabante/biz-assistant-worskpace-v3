'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'status', {
      type: Sequelize.ENUM('pending_verification', 'active', 'suspended', 'invited'),
      allowNull: false,
      defaultValue: 'pending_verification',
    });

    await queryInterface.addColumn('users', 'is_email_verified', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('users', 'email_verified_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('users', ['status'], {
      name: 'users_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_status');
    await queryInterface.removeColumn('users', 'email_verified_at');
    await queryInterface.removeColumn('users', 'is_email_verified');
    await queryInterface.removeColumn('users', 'status');
  },
};
