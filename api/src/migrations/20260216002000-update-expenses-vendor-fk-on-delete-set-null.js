'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [fkRows] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'expenses'
        AND COLUMN_NAME = 'vendor_id'
        AND REFERENCED_TABLE_NAME = 'vendors'
        AND REFERENCED_COLUMN_NAME = 'id'
    `);

    for (const row of fkRows) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeConstraint('expenses', row.CONSTRAINT_NAME);
    }

    await queryInterface.changeColumn('expenses', 'vendor_id', {
      type: Sequelize.UUID,
      allowNull: true,
    });

    await queryInterface.addConstraint('expenses', {
      fields: ['vendor_id'],
      type: 'foreign key',
      name: 'fk_expenses_vendor_id',
      references: {
        table: 'vendors',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('expenses', 'fk_expenses_vendor_id');

    await queryInterface.addConstraint('expenses', {
      fields: ['vendor_id'],
      type: 'foreign key',
      name: 'fk_expenses_vendor_id',
      references: {
        table: 'vendors',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    await queryInterface.changeColumn('expenses', 'vendor_id', {
      type: Sequelize.UUID,
      allowNull: true,
    });
  },
};
