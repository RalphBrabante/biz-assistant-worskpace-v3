'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('expenses');
    if (table.vat_amount) {
      await queryInterface.removeColumn('expenses', 'vat_amount');
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('expenses');
    if (!table.vat_amount) {
      await queryInterface.addColumn('expenses', 'vat_amount', {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      });
    }
  },
};
