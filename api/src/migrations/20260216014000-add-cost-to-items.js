'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('items', 'cost', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0.0,
    });
    await queryInterface.addIndex('items', ['cost'], {
      name: 'items_cost',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('items', 'items_cost');
    await queryInterface.removeColumn('items', 'cost');
  },
};
