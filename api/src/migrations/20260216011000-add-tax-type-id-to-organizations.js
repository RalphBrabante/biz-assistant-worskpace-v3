'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'tax_type_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'tax_types',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
      after: 'currency',
    });

    await queryInterface.addIndex('organizations', ['tax_type_id'], {
      name: 'organizations_tax_type_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('organizations', 'organizations_tax_type_id');
    await queryInterface.removeColumn('organizations', 'tax_type_id');
  },
};

