'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const existingIndexes = await queryInterface.showIndex('user_roles');
    const hasAssignedByIndex = existingIndexes.some(
      (idx) => idx.name === 'user_roles_assigned_by_user_id'
    );

    if (!hasAssignedByIndex) {
      await queryInterface.addIndex('user_roles', ['assigned_by_user_id'], {
        name: 'user_roles_assigned_by_user_id',
      });
    }

    const [foreignKeys] = await queryInterface.sequelize.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'user_roles'
        AND COLUMN_NAME = 'assigned_by_user_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    if (foreignKeys.length === 0) {
      await queryInterface.addConstraint('user_roles', {
        fields: ['assigned_by_user_id'],
        type: 'foreign key',
        name: 'user_roles_assigned_by_user_id_fk',
        references: {
          table: 'users',
          field: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeConstraint(
        'user_roles',
        'user_roles_assigned_by_user_id_fk'
      );
    } catch (_) {
      // ignore if not present
    }

    try {
      await queryInterface.removeIndex('user_roles', 'user_roles_assigned_by_user_id');
    } catch (_) {
      // ignore if not present
    }
  },
};
