'use strict';

async function findOrderIdForeignKeys(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT DISTINCT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    JOIN information_schema.TABLE_CONSTRAINTS tc
      ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND tc.TABLE_NAME = kcu.TABLE_NAME
      AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
    WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'sales_invoices'
      AND kcu.COLUMN_NAME = 'order_id'
      AND kcu.REFERENCED_TABLE_NAME = 'orders'
      AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
  `);
  return rows.map((row) => row.CONSTRAINT_NAME).filter(Boolean);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const fkNames = await findOrderIdForeignKeys(queryInterface);
    for (const fkName of fkNames) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeConstraint('sales_invoices', fkName);
    }

    await queryInterface.changeColumn('sales_invoices', 'order_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'orders',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    await queryInterface.addConstraint('sales_invoices', {
      fields: ['order_id'],
      type: 'foreign key',
      name: 'fk_sales_invoices_order_id',
      references: {
        table: 'orders',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  },

  async down(queryInterface, Sequelize) {
    const fkNames = await findOrderIdForeignKeys(queryInterface);
    for (const fkName of fkNames) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeConstraint('sales_invoices', fkName);
    }

    await queryInterface.changeColumn('sales_invoices', 'order_id', {
      type: Sequelize.UUID,
      allowNull: false,
      references: {
        model: 'orders',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    await queryInterface.addConstraint('sales_invoices', {
      fields: ['order_id'],
      type: 'foreign key',
      name: 'fk_sales_invoices_order_id',
      references: {
        table: 'orders',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  },
};
