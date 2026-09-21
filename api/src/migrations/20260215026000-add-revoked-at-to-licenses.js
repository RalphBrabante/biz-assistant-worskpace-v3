'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('licenses');

    if (!table.revoked_at) {
      await queryInterface.addColumn('licenses', 'revoked_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    const indexes = await queryInterface.showIndex('licenses');
    const hasIndex = indexes.some((idx) => idx.name === 'licenses_revoked_at');
    if (!hasIndex) {
      await queryInterface.addIndex('licenses', ['revoked_at'], {
        name: 'licenses_revoked_at',
      });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('licenses');
    const hasIndex = indexes.some((idx) => idx.name === 'licenses_revoked_at');
    if (hasIndex) {
      await queryInterface.removeIndex('licenses', 'licenses_revoked_at');
    }

    const table = await queryInterface.describeTable('licenses');
    if (table.revoked_at) {
      await queryInterface.removeColumn('licenses', 'revoked_at');
    }
  },
};
