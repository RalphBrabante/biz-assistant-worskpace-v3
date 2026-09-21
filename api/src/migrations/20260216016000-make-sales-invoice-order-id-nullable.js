'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('sales_invoices', 'order_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'orders',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('sales_invoices', 'order_id', {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: 'orders',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  },
};
