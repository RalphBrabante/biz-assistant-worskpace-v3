'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'licenses';

    const [fkRows] = await queryInterface.sequelize.query(
      `
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME = 'organization_id'
        AND REFERENCED_TABLE_NAME = 'organizations'
      `,
      {
        replacements: { tableName },
      }
    );

    for (const fk of fkRows || []) {
      if (fk?.CONSTRAINT_NAME) {
        await queryInterface.removeConstraint(tableName, fk.CONSTRAINT_NAME);
      }
    }

    await queryInterface.changeColumn(tableName, 'organization_id', {
      type: Sequelize.UUID,
      allowNull: true,
    });

    await queryInterface.addConstraint(tableName, {
      fields: ['organization_id'],
      type: 'foreign key',
      name: 'licenses_organization_id_fk',
      references: {
        table: 'organizations',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.sequelize.query(`
      UPDATE licenses
      SET \`key\` = UUID()
      WHERE \`key\` IS NULL
         OR \`key\` NOT REGEXP '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    `);

    await queryInterface.changeColumn(tableName, 'key', {
      type: Sequelize.UUID,
      allowNull: false,
      unique: true,
    });
  },

  async down(queryInterface, Sequelize) {
    const tableName = 'licenses';

    const [fkRows] = await queryInterface.sequelize.query(
      `
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME = 'organization_id'
        AND REFERENCED_TABLE_NAME = 'organizations'
      `,
      {
        replacements: { tableName },
      }
    );

    for (const fk of fkRows || []) {
      if (fk?.CONSTRAINT_NAME) {
        await queryInterface.removeConstraint(tableName, fk.CONSTRAINT_NAME);
      }
    }

    await queryInterface.changeColumn(tableName, 'organization_id', {
      type: Sequelize.UUID,
      allowNull: false,
    });

    await queryInterface.addConstraint(tableName, {
      fields: ['organization_id'],
      type: 'foreign key',
      name: 'licenses_organization_id_fk',
      references: {
        table: 'organizations',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });

    await queryInterface.changeColumn(tableName, 'key', {
      type: Sequelize.STRING(120),
      allowNull: false,
      unique: true,
    });
  },
};
