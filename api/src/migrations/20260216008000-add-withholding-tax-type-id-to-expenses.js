'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expenses', 'withholding_tax_type_id', {
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

    await queryInterface.addIndex('expenses', ['withholding_tax_type_id'], {
      name: 'expenses_withholding_tax_type_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('expenses', 'expenses_withholding_tax_type_id');
    await queryInterface.removeColumn('expenses', 'withholding_tax_type_id');
  },
};

