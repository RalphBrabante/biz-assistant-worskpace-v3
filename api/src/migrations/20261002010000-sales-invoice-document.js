'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await queryInterface.describeTable('sales_invoices')).invoice_document) {
      await queryInterface.addColumn('sales_invoices', 'invoice_document', { type: Sequelize.JSON, allowNull: true });
    }
  },
  async down(queryInterface) { await queryInterface.removeColumn('sales_invoices', 'invoice_document'); },
};
