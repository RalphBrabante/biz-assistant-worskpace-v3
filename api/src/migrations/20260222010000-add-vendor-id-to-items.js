'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('items', 'vendor_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'vendors',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('items', ['vendor_id'], {
      name: 'items_vendor_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('items', 'items_vendor_id');
    await queryInterface.removeColumn('items', 'vendor_id');
  },
};

