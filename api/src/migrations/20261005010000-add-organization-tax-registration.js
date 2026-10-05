'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'rdo_code', {
      type: Sequelize.STRING(3), allowNull: true,
    });
    await queryInterface.addColumn('organizations', 'taxpayer_size', {
      type: Sequelize.STRING(10), allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('organizations', 'taxpayer_size');
    await queryInterface.removeColumn('organizations', 'rdo_code');
  },
};
