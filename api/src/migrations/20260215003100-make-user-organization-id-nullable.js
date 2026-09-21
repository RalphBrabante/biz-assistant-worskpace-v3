'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [foreignKeys] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'organization_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    for (const row of foreignKeys) {
      await queryInterface.sequelize.query(
        `ALTER TABLE users DROP FOREIGN KEY ${row.CONSTRAINT_NAME}`
      );
    }

    await queryInterface.sequelize.query(
      'ALTER TABLE users MODIFY organization_id CHAR(36) BINARY NULL'
    );

    await queryInterface.addConstraint('users', {
      fields: ['organization_id'],
      type: 'foreign key',
      name: 'users_organization_id_fk',
      references: {
        table: 'organizations',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface, Sequelize) {
    const [foreignKeys] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'organization_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    for (const row of foreignKeys) {
      await queryInterface.sequelize.query(
        `ALTER TABLE users DROP FOREIGN KEY ${row.CONSTRAINT_NAME}`
      );
    }

    await queryInterface.sequelize.query(
      'ALTER TABLE users MODIFY organization_id CHAR(36) BINARY NOT NULL'
    );

    await queryInterface.addConstraint('users', {
      fields: ['organization_id'],
      type: 'foreign key',
      name: 'users_organization_id_fk',
      references: {
        table: 'organizations',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  },
};
