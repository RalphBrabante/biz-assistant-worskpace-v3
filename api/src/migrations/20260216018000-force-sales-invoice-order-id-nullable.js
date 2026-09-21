'use strict';

async function listOrderIdForeignKeys(queryInterface) {
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
      AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
  `);
  return rows.map((row) => row.CONSTRAINT_NAME).filter(Boolean);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const fkNames = await listOrderIdForeignKeys(queryInterface);
    for (const fkName of fkNames) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeConstraint('sales_invoices', fkName);
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE sales_invoices
      MODIFY COLUMN order_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
    `);

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

  async down(queryInterface) {
    const fkNames = await listOrderIdForeignKeys(queryInterface);
    for (const fkName of fkNames) {
      // eslint-disable-next-line no-await-in-loop
      await queryInterface.removeConstraint('sales_invoices', fkName);
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE sales_invoices
      MODIFY COLUMN order_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
    `);

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
