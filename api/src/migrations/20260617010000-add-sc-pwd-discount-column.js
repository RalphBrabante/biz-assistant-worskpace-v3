'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_invoices', 'sc_pwd_discount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'discount_amount',
    });

    await queryInterface.addColumn('expenses', 'sc_pwd_discount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'discount_amount',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('sales_invoices', 'sc_pwd_discount');
    await queryInterface.removeColumn('expenses', 'sc_pwd_discount');
  },
};
