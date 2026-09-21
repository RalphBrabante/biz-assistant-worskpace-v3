'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('expenses', 'net_vat');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('expenses', 'net_vat', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'taxable_amount',
    });
  },
};

