'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expenses', 'vat_exempt');
    await queryInterface.addColumn('expenses', 'vat_exempt_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expenses', 'vat_exempt_amount');
    await queryInterface.addColumn('expenses', 'vat_exempt', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
};
