'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'with_holding_tax_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
      after: 'tax_amount',
    });

    await queryInterface.addColumn('orders', 'withholding_tax_type_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'withholding_tax_types',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      after: 'with_holding_tax_amount',
    });

    await queryInterface.addIndex('orders', ['with_holding_tax_amount'], {
      name: 'orders_with_holding_tax_amount',
    });
    await queryInterface.addIndex('orders', ['withholding_tax_type_id'], {
      name: 'orders_withholding_tax_type_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('orders', 'orders_withholding_tax_type_id');
    await queryInterface.removeIndex('orders', 'orders_with_holding_tax_amount');
    await queryInterface.removeColumn('orders', 'withholding_tax_type_id');
    await queryInterface.removeColumn('orders', 'with_holding_tax_amount');
  },
};
