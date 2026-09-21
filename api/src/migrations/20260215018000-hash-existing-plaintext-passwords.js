'use strict';
const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      `
      SELECT id, password
      FROM users
      WHERE password IS NOT NULL
        AND password <> ''
        AND password NOT LIKE '$2a$%'
        AND password NOT LIKE '$2b$%'
        AND password NOT LIKE '$2y$%'
    `
    );

    for (const row of rows) {
      const hashedPassword = await bcrypt.hash(row.password, 10);
      await queryInterface.sequelize.query(
        `
        UPDATE users
        SET password = :password, updated_at = NOW()
        WHERE id = :id
      `,
        {
          replacements: {
            id: row.id,
            password: hashedPassword,
          },
        }
      );
    }
  },

  async down() {
    // Irreversible by design: plaintext source is not retained.
  },
};
