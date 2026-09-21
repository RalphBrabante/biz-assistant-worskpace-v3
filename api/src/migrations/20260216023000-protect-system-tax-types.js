'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tax_types', 'is_system', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addIndex('tax_types', ['is_system'], {
      name: 'tax_types_is_system',
    });

    await queryInterface.addColumn('withholding_tax_types', 'is_system', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addIndex('withholding_tax_types', ['is_system'], {
      name: 'withholding_tax_types_is_system',
    });

    await queryInterface.sequelize.query(`
      UPDATE tax_types
      SET is_system = 1
      WHERE code IN ('VAT', 'PT');
    `);
    await queryInterface.sequelize.query(`
      UPDATE withholding_tax_types
      SET is_system = 1
      WHERE code IN ('WHT_GOODS_1', 'WHT_SERVICES_2');
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS tax_types_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER tax_types_prevent_system_delete
      BEFORE DELETE ON tax_types
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System tax types cannot be deleted';
        END IF;
      END;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS tax_types_prevent_system_unset;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER tax_types_prevent_system_unset
      BEFORE UPDATE ON tax_types
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 AND NEW.is_system = 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System tax types cannot be downgraded';
        END IF;
      END;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS withholding_tax_types_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER withholding_tax_types_prevent_system_delete
      BEFORE DELETE ON withholding_tax_types
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System withholding tax types cannot be deleted';
        END IF;
      END;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS withholding_tax_types_prevent_system_unset;
    `);
    await queryInterface.sequelize.query(`
      CREATE TRIGGER withholding_tax_types_prevent_system_unset
      BEFORE UPDATE ON withholding_tax_types
      FOR EACH ROW
      BEGIN
        IF OLD.is_system = 1 AND NEW.is_system = 0 THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'System withholding tax types cannot be downgraded';
        END IF;
      END;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS tax_types_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS tax_types_prevent_system_unset;
    `);
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS withholding_tax_types_prevent_system_delete;
    `);
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS withholding_tax_types_prevent_system_unset;
    `);

    await queryInterface.removeIndex('withholding_tax_types', 'withholding_tax_types_is_system');
    await queryInterface.removeColumn('withholding_tax_types', 'is_system');
    await queryInterface.removeIndex('tax_types', 'tax_types_is_system');
    await queryInterface.removeColumn('tax_types', 'is_system');
  },
};
