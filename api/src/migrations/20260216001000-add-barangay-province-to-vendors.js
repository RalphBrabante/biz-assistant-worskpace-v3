'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('vendors', 'barangay', {
      type: Sequelize.STRING(120),
      allowNull: true,
      after: 'state',
    });

    await queryInterface.addColumn('vendors', 'province', {
      type: Sequelize.STRING(120),
      allowNull: true,
      after: 'barangay',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vendors', 'province');
    await queryInterface.removeColumn('vendors', 'barangay');
  },
};
