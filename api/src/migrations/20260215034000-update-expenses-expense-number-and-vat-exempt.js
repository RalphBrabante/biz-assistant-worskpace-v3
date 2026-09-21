'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('expenses', 'expense_number', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    await queryInterface.addColumn('expenses', 'vat_exempt', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('expenses', 'vat_exempt');

    await queryInterface.changeColumn('expenses', 'expense_number', {
      type: Sequelize.STRING(100),
      allowNull: false,
    });
  },
};
