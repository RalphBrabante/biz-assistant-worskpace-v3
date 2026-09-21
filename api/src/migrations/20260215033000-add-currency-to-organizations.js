'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'currency', {
      type: Sequelize.STRING(3),
      allowNull: false,
      defaultValue: 'USD',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('organizations', 'currency');
  },
};
