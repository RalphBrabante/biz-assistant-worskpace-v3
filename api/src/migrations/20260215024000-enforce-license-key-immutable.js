'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS licenses_prevent_key_update');
    await queryInterface.sequelize.query(`
      CREATE TRIGGER licenses_prevent_key_update
      BEFORE UPDATE ON licenses
      FOR EACH ROW
      BEGIN
        IF NEW.\`key\` <> OLD.\`key\` THEN
          SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'License key is immutable and cannot be updated.';
        END IF;
      END
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS licenses_prevent_key_update');
  },
};
