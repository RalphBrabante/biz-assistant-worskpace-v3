'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('vendors', 'category', {
      type: Sequelize.ENUM('goods', 'operations', 'others'),
      allowNull: false,
      defaultValue: 'others',
      after: 'tax_id',
    });

    await queryInterface.addIndex('vendors', ['category'], {
      name: 'vendors_category',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('vendors', 'vendors_category');
    await queryInterface.removeColumn('vendors', 'category');
  },
};
