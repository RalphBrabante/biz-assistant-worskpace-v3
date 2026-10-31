'use strict';

// Records which expiry notice a license has already sent, so each one goes out once
// even when several API replicas run the expiry job.
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('licenses');

    if (!table.expiry_notice_stage) {
      await queryInterface.addColumn('licenses', 'expiry_notice_stage', {
        type: Sequelize.TINYINT.UNSIGNED,
        allowNull: true,
      });
    }
    if (!table.expiry_notice_sent_at) {
      await queryInterface.addColumn('licenses', 'expiry_notice_sent_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    const indexes = await queryInterface.showIndex('licenses');
    if (!indexes.some((idx) => idx.name === 'licenses_status_expires_at')) {
      await queryInterface.addIndex('licenses', ['status', 'expires_at'], {
        name: 'licenses_status_expires_at',
      });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('licenses');
    if (indexes.some((idx) => idx.name === 'licenses_status_expires_at')) {
      await queryInterface.removeIndex('licenses', 'licenses_status_expires_at');
    }

    const table = await queryInterface.describeTable('licenses');
    if (table.expiry_notice_sent_at) {
      await queryInterface.removeColumn('licenses', 'expiry_notice_sent_at');
    }
    if (table.expiry_notice_stage) {
      await queryInterface.removeColumn('licenses', 'expiry_notice_stage');
    }
  },
};
