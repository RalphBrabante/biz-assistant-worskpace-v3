'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expenses', 'taxable_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'vat_exempt_amount',
    });

    await queryInterface.addIndex('expenses', ['taxable_amount'], {
      name: 'expenses_taxable_amount',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('expenses', 'expenses_taxable_amount');
    await queryInterface.removeColumn('expenses', 'taxable_amount');
  },
};

