'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('expenses');
    for (const name of ['receipt_vat_amount', 'withholding_tax_base']) {
      if (!columns[name]) await queryInterface.addColumn('expenses', name, { type: Sequelize.DECIMAL(12, 2), allowNull: true });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('expenses', 'withholding_tax_base');
    await queryInterface.removeColumn('expenses', 'receipt_vat_amount');
  },
};
