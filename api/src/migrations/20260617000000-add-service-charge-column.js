'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_invoices', 'service_charge', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'discount_amount',
    });

    await queryInterface.addColumn('expenses', 'service_charge', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'discount_amount',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sales_invoices', 'service_charge');
    await queryInterface.removeColumn('expenses', 'service_charge');
  },
};
