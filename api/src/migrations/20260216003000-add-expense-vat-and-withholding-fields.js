'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expenses', 'vat_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'vat_exempt_amount',
    });

    await queryInterface.addColumn('expenses', 'net_vat', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'vat_amount',
    });

    await queryInterface.addColumn('expenses', 'with_holding_tax_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'net_vat',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('expenses', 'with_holding_tax_amount');
    await queryInterface.removeColumn('expenses', 'net_vat');
    await queryInterface.removeColumn('expenses', 'vat_amount');
  },
};
