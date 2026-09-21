'use strict';

const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const now = new Date();
      const userId = '9a8b7c6d-5e4f-4321-8abc-1234567890ab';
      const email = 'ralphjohnbrabante@gmail.com';
      const passwordHash = await bcrypt.hash('Default123!', 10);

      const [orgRows] = await queryInterface.sequelize.query(
        'SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1',
        { transaction }
      );
      const organizationId = orgRows[0] ? String(orgRows[0].id) : null;

      await queryInterface.sequelize.query(
        `
        INSERT INTO users (
          id, organization_id, first_name, last_name, email, password,
          phone, address_line1, address_line2, city, state, postal_code, country,
          role, status, is_email_verified, email_verified_at, is_active, last_login_at,
          created_at, updated_at
        ) VALUES (
          :id, :organizationId, :firstName, :lastName, :email, :password,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          :role, :status, true, :emailVerifiedAt, true, NULL,
          :createdAt, :updatedAt
        )
        ON DUPLICATE KEY UPDATE
          organization_id = VALUES(organization_id),
          first_name = VALUES(first_name),
          last_name = VALUES(last_name),
          email = VALUES(email),
          password = VALUES(password),
          role = VALUES(role),
          status = VALUES(status),
          is_email_verified = VALUES(is_email_verified),
          email_verified_at = VALUES(email_verified_at),
          is_active = VALUES(is_active),
          updated_at = VALUES(updated_at)
      `,
        {
          replacements: {
            id: userId,
            organizationId,
            firstName: 'Ralph',
            lastName: 'Brabante',
            email,
            password: passwordHash,
            role: 'SUPERUSER',
            status: 'active',
            emailVerifiedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          transaction,
        }
      );

      const [roleRows] = await queryInterface.sequelize.query(
        `
        SELECT id
        FROM roles
        WHERE code = 'superuser' OR name = 'SUPERUSER'
        ORDER BY created_at ASC
        LIMIT 1
      `,
        { transaction }
      );

      if (!roleRows[0]) {
        throw new Error('SUPERUSER role not found. Run RBAC seed first.');
      }

      const superuserRoleId = String(roleRows[0].id);

      await queryInterface.sequelize.query(
        `
        INSERT INTO user_roles (
          id, user_id, role_id, assigned_at, assigned_by_user_id, is_active, created_at, updated_at
        ) VALUES (
          UUID(), :userId, :roleId, :assignedAt, NULL, true, :createdAt, :updatedAt
        )
        ON DUPLICATE KEY UPDATE
          is_active = VALUES(is_active),
          updated_at = VALUES(updated_at)
      `,
        {
          replacements: {
            userId,
            roleId: superuserRoleId,
            assignedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          transaction,
        }
      );

      if (organizationId) {
        await queryInterface.sequelize.query(
          `
          INSERT INTO organization_users (
            id, organization_id, user_id, role, is_active, created_at, updated_at
          ) VALUES (
            UUID(), :organizationId, :userId, :role, true, :createdAt, :updatedAt
          )
          ON DUPLICATE KEY UPDATE
            role = VALUES(role),
            is_active = VALUES(is_active),
            updated_at = VALUES(updated_at)
        `,
          {
            replacements: {
              organizationId,
              userId,
              role: 'SUPERUSER',
              createdAt: now,
              updatedAt: now,
            },
            transaction,
          }
        );
      }

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const userId = '9a8b7c6d-5e4f-4321-8abc-1234567890ab';
      const email = 'ralphjohnbrabante@gmail.com';

      await queryInterface.bulkDelete('organization_users', { user_id: userId }, { transaction });
      await queryInterface.bulkDelete('user_roles', { user_id: userId }, { transaction });
      await queryInterface.bulkDelete('users', { email }, { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
