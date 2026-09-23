'use strict';

// Country selection normally comes from the browser. Keep the database fallback
// consistent with the organization API when a country is omitted.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("ALTER TABLE organizations ALTER COLUMN country SET DEFAULT 'Philippines'");
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query("ALTER TABLE organizations ALTER COLUMN country SET DEFAULT 'United States'");
  },
};
