'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');

    if (!table.customer_id) {
      await queryInterface.addColumn('orders', 'customer_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'customers',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }

    const indexes = await queryInterface.showIndex('orders');
    const hasIndex = indexes.some((idx) => idx.name === 'orders_customer_id');
    if (!hasIndex) {
      await queryInterface.addIndex('orders', ['customer_id'], {
        name: 'orders_customer_id',
      });
    }
  },

  async down(queryInterface) {
    const indexes = await queryInterface.showIndex('orders');
    const hasIndex = indexes.some((idx) => idx.name === 'orders_customer_id');
    if (hasIndex) {
      await queryInterface.removeIndex('orders', 'orders_customer_id');
    }

    const table = await queryInterface.describeTable('orders');
    if (table.customer_id) {
      await queryInterface.removeColumn('orders', 'customer_id');
    }
  },
};
