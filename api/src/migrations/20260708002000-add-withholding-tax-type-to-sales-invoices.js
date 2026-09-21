'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sales_invoices', 'withholding_tax_type_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'withholding_tax_types',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('sales_invoices', ['withholding_tax_type_id'], {
      name: 'sales_invoices_withholding_tax_type_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('sales_invoices', 'sales_invoices_withholding_tax_type_id');
    await queryInterface.removeColumn('sales_invoices', 'withholding_tax_type_id');
  },
};
