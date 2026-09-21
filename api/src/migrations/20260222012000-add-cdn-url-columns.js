'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('expenses', 'file_cdn_url', {
      type: Sequelize.STRING(1000),
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'profile_image_cdn_url', {
      type: Sequelize.STRING(1000),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'profile_image_cdn_url');
    await queryInterface.removeColumn('expenses', 'file_cdn_url');
  },
};
