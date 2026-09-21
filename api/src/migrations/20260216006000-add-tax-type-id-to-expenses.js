'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expenses', 'tax_type_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'tax_types',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      after: 'tax_amount',
    });

    await queryInterface.addIndex('expenses', ['tax_type_id'], {
      name: 'expenses_tax_type_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('expenses', 'expenses_tax_type_id');
    await queryInterface.removeColumn('expenses', 'tax_type_id');
  },
};
