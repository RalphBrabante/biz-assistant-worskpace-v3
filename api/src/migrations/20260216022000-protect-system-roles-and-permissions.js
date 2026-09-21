'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS roles_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER roles_prevent_system_delete
      BEFORE DELETE ON roles
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System roles cannot be deleted';
        END IF;
      END;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS roles_prevent_system_unset;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER roles_prevent_system_unset
      BEFORE UPDATE ON roles
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 AND NEW.is_system = 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System roles cannot be downgraded';
        END IF;
      END;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS permissions_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER permissions_prevent_system_delete
      BEFORE DELETE ON permissions
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System permissions cannot be deleted';
        END IF;
      END;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS permissions_prevent_system_unset;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER permissions_prevent_system_unset
      BEFORE UPDATE ON permissions
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 AND NEW.is_system = 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System permissions cannot be downgraded';
        END IF;
      END;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS roles_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS roles_prevent_system_unset;
    `);
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS permissions_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS permissions_prevent_system_unset;
    `);
  },
};
