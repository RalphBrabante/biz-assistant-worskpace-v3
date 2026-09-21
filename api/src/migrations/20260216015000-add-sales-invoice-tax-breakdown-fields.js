'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_invoices', 'amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'currency',
    });
    await queryInterface.addColumn('sales_invoices', 'taxable_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'amount',
    });
    await queryInterface.addColumn('sales_invoices', 'with_holding_tax_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'taxable_amount',
    });

    await queryInterface.addIndex('sales_invoices', ['amount'], {
      name: 'sales_invoices_amount',
    });
    await queryInterface.addIndex('sales_invoices', ['taxable_amount'], {
      name: 'sales_invoices_taxable_amount',
    });
    await queryInterface.addIndex('sales_invoices', ['with_holding_tax_amount'], {
      name: 'sales_invoices_with_holding_tax_amount',
    });

    await queryInterface.sequelize.query(`
      UPDATE sales_invoices
      SET
        amount = COALESCE(subtotal_amount, 0),
        taxable_amount = GREATEST(COALESCE(subtotal_amount, 0) - COALESCE(tax_amount, 0), 0),
        with_holding_tax_amount = COALESCE(with_holding_tax_amount, 0)
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sales_invoices', 'sales_invoices_with_holding_tax_amount');
    await queryInterface.removeIndex('sales_invoices', 'sales_invoices_taxable_amount');
    await queryInterface.removeIndex('sales_invoices', 'sales_invoices_amount');
    await queryInterface.removeColumn('sales_invoices', 'with_holding_tax_amount');
    await queryInterface.removeColumn('sales_invoices', 'taxable_amount');
    await queryInterface.removeColumn('sales_invoices', 'amount');
  },
};
