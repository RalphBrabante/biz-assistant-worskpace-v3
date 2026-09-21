'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'taxpayer_classification', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('organizations', 'deduction_method', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'itemized',
    });
    await queryInterface.addColumn('organizations', 'income_tax_rate', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('organizations', 'is_income_tax_exempt', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addIndex('organizations', ['taxpayer_classification'], {
      name: 'organizations_taxpayer_classification',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('organizations', 'organizations_taxpayer_classification');
    await queryInterface.removeColumn('organizations', 'is_income_tax_exempt');
    await queryInterface.removeColumn('organizations', 'income_tax_rate');
    await queryInterface.removeColumn('organizations', 'deduction_method');
    await queryInterface.removeColumn('organizations', 'taxpayer_classification');
  },
};
