'use strict';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      const now = new Date();

      const roles = [
        {
          code: 'administrator',
          name: 'ADMINISTRATOR',
          description: 'Full administrative access',
        },
        {
          code: 'superuser',
          name: 'SUPERUSER',
          description: 'System-wide superuser access',
        },
        {
          code: 'enduser',
          name: 'ENDUSER',
          description: 'Standard end-user access',
        },
        {
          code: 'accountant',
          name: 'ACCOUNTANT',
          description: 'Accounting and finance access',
        },
        {
          code: 'inventorymanager',
          name: 'INVENTORYMANAGER',
          description: 'Inventory and purchasing management access',
        },
      ];

      const permissions = [
        { code: 'users.read', name: 'Read Users', resource: 'users', action: 'read' },
        { code: 'users.create', name: 'Create Users', resource: 'users', action: 'create' },
        { code: 'users.update', name: 'Update Users', resource: 'users', action: 'update' },
        { code: 'users.delete', name: 'Delete Users', resource: 'users', action: 'delete' },
        { code: 'roles.manage', name: 'Manage Roles', resource: 'roles', action: 'manage' },
        {
          code: 'permissions.manage',
          name: 'Manage Permissions',
          resource: 'permissions',
          action: 'manage',
        },
        {
          code: 'organizations.read',
          name: 'Read Organizations',
          resource: 'organizations',
          action: 'read',
        },
        {
          code: 'organizations.update',
          name: 'Update Organizations',
          resource: 'organizations',
          action: 'update',
        },
        { code: 'items.read', name: 'Read Items', resource: 'items', action: 'read' },
        { code: 'items.create', name: 'Create Items', resource: 'items', action: 'create' },
        { code: 'items.update', name: 'Update Items', resource: 'items', action: 'update' },
        { code: 'items.delete', name: 'Delete Items', resource: 'items', action: 'delete' },
        { code: 'vendors.read', name: 'Read Vendors', resource: 'vendors', action: 'read' },
        { code: 'vendors.create', name: 'Create Vendors', resource: 'vendors', action: 'create' },
        { code: 'vendors.update', name: 'Update Vendors', resource: 'vendors', action: 'update' },
        { code: 'vendors.delete', name: 'Delete Vendors', resource: 'vendors', action: 'delete' },
        { code: 'expenses.read', name: 'Read Expenses', resource: 'expenses', action: 'read' },
        { code: 'expenses.create', name: 'Create Expenses', resource: 'expenses', action: 'create' },
        { code: 'expenses.update', name: 'Update Expenses', resource: 'expenses', action: 'update' },
        { code: 'expenses.delete', name: 'Delete Expenses', resource: 'expenses', action: 'delete' },
        { code: 'expenses.approve', name: 'Approve Expenses', resource: 'expenses', action: 'approve' },
        { code: 'expenses.pay', name: 'Pay Expenses', resource: 'expenses', action: 'pay' },
        { code: 'orders.read', name: 'Read Orders', resource: 'orders', action: 'read' },
        { code: 'orders.create', name: 'Create Orders', resource: 'orders', action: 'create' },
        { code: 'orders.update', name: 'Update Orders', resource: 'orders', action: 'update' },
        { code: 'orders.fulfill', name: 'Fulfill Orders', resource: 'orders', action: 'fulfill' },
        {
          code: 'purchase_orders.read',
          name: 'Read Purchase Orders',
          resource: 'purchase_orders',
          action: 'read',
        },
        {
          code: 'purchase_orders.create',
          name: 'Create Purchase Orders',
          resource: 'purchase_orders',
          action: 'create',
        },
        {
          code: 'purchase_orders.update',
          name: 'Update Purchase Orders',
          resource: 'purchase_orders',
          action: 'update',
        },
        {
          code: 'purchase_orders.approve',
          name: 'Approve Purchase Orders',
          resource: 'purchase_orders',
          action: 'approve',
        },
        {
          code: 'sales_invoices.read',
          name: 'Read Sales Invoices',
          resource: 'sales_invoices',
          action: 'read',
        },
        {
          code: 'sales_invoices.create',
          name: 'Create Sales Invoices',
          resource: 'sales_invoices',
          action: 'create',
        },
        {
          code: 'sales_invoices.update',
          name: 'Update Sales Invoices',
          resource: 'sales_invoices',
          action: 'update',
        },
        {
          code: 'sales_invoices.pay',
          name: 'Pay Sales Invoices',
          resource: 'sales_invoices',
          action: 'pay',
        },
        {
          code: 'licenses.read',
          name: 'Read Licenses',
          resource: 'licenses',
          action: 'read',
        },
        {
          code: 'licenses.manage',
          name: 'Manage Licenses',
          resource: 'licenses',
          action: 'manage',
        },
        {
          code: 'withholding_tax_types.read',
          name: 'Read Withholding Tax Types',
          resource: 'withholding_tax_types',
          action: 'read',
        },
        {
          code: 'withholding_tax_types.create',
          name: 'Create Withholding Tax Types',
          resource: 'withholding_tax_types',
          action: 'create',
        },
        {
          code: 'withholding_tax_types.update',
          name: 'Update Withholding Tax Types',
          resource: 'withholding_tax_types',
          action: 'update',
        },
        { code: 'reports.read', name: 'Read Reports', resource: 'reports', action: 'read' },
        { code: 'reports.generate', name: 'Generate Reports', resource: 'reports', action: 'generate' },
        { code: 'reports.delete', name: 'Delete Reports', resource: 'reports', action: 'delete' },
        {
          code: 'settings.update',
          name: 'Update Settings',
          resource: 'settings',
          action: 'update',
        },
        {
          code: 'profile.manage',
          name: 'Manage Own Profile',
          resource: 'profile',
          action: 'manage',
        },
      ];

      const rolePermissions = {
        administrator: permissions.map((permission) => permission.code),
        superuser: permissions.map((permission) => permission.code),
        enduser: ['items.read', 'orders.read', 'orders.create', 'sales_invoices.read', 'profile.manage'],
        accountant: [
          'organizations.read',
          'vendors.read',
          'expenses.read',
          'expenses.create',
          'expenses.update',
          'expenses.delete',
          'expenses.approve',
          'expenses.pay',
          'sales_invoices.read',
          'sales_invoices.create',
          'sales_invoices.update',
          'sales_invoices.pay',
          'licenses.read',
          'withholding_tax_types.read',
          'withholding_tax_types.create',
          'withholding_tax_types.update',
          'reports.read',
          'reports.generate',
          'reports.delete',
          'profile.manage',
        ],
        inventorymanager: [
          'items.read',
          'items.create',
          'items.update',
          'items.delete',
          'vendors.read',
          'vendors.create',
          'vendors.update',
          'purchase_orders.read',
          'purchase_orders.create',
          'purchase_orders.update',
          'purchase_orders.approve',
          'orders.read',
          'orders.update',
          'orders.fulfill',
          'reports.read',
          'profile.manage',
        ],
      };

      for (const role of roles) {
        await queryInterface.sequelize.query(
          `
          INSERT INTO roles (id, name, code, description, is_system, is_active, created_at, updated_at)
          VALUES (UUID(), :name, :code, :description, true, true, :createdAt, :updatedAt)
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            description = VALUES(description),
            is_system = VALUES(is_system),
            is_active = VALUES(is_active),
            updated_at = VALUES(updated_at)
        `,
          {
            replacements: {
              name: role.name,
              code: role.code,
              description: role.description,
              createdAt: now,
              updatedAt: now,
            },
            transaction,
          }
        );
      }

      for (const permission of permissions) {
        await queryInterface.sequelize.query(
          `
          INSERT INTO permissions (
            id, name, code, resource, action, description, is_system, is_active, created_at, updated_at
          )
          VALUES (
            UUID(), :name, :code, :resource, :action, :description, true, true, :createdAt, :updatedAt
          )
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            resource = VALUES(resource),
            action = VALUES(action),
            description = VALUES(description),
            is_system = VALUES(is_system),
            is_active = VALUES(is_active),
            updated_at = VALUES(updated_at)
        `,
          {
            replacements: {
              ...permission,
              description: `${permission.name} permission`,
              createdAt: now,
              updatedAt: now,
            },
            transaction,
          }
        );
      }

      const [roleRows] = await queryInterface.sequelize.query(
        'SELECT id, code FROM roles WHERE code IN (:codes)',
        {
          replacements: { codes: roles.map((role) => role.code) },
          transaction,
        }
      );

      const [permissionRows] = await queryInterface.sequelize.query(
        'SELECT id, code FROM permissions WHERE code IN (:codes)',
        {
          replacements: { codes: permissions.map((permission) => permission.code) },
          transaction,
        }
      );

      const roleIdByCode = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      const permissionIdByCode = Object.fromEntries(
        permissionRows.map((row) => [row.code, row.id])
      );

      for (const [roleCode, permissionCodes] of Object.entries(rolePermissions)) {
        const roleId = roleIdByCode[roleCode];
        if (!roleId) {
          // Skip invalid mapping if role not found.
          // eslint-disable-next-line no-continue
          continue;
        }

        for (const permissionCode of permissionCodes) {
          const permissionId = permissionIdByCode[permissionCode];
          if (!permissionId) {
            // eslint-disable-next-line no-continue
            continue;
          }

          await queryInterface.sequelize.query(
            `
            INSERT INTO role_permissions (
              id, role_id, permission_id, is_allowed, scope, constraints,
              assigned_by_user_id, assigned_at, is_active, created_at, updated_at
            )
            VALUES (
              UUID(), :roleId, :permissionId, true, NULL, NULL,
              NULL, :assignedAt, true, :createdAt, :updatedAt
            )
            ON DUPLICATE KEY UPDATE
              is_allowed = VALUES(is_allowed),
              is_active = VALUES(is_active),
              updated_at = VALUES(updated_at)
          `,
            {
              replacements: {
                roleId,
                permissionId,
                assignedAt: now,
                createdAt: now,
                updatedAt: now,
              },
              transaction,
            }
          );
        }
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
      const roleCodes = [
        'administrator',
        'superuser',
        'enduser',
        'accountant',
        'inventorymanager',
      ];

      const permissionCodes = [
        'users.read',
        'users.create',
        'users.update',
        'users.delete',
        'roles.manage',
        'permissions.manage',
        'organizations.read',
        'organizations.update',
        'items.read',
        'items.create',
        'items.update',
        'items.delete',
        'vendors.read',
        'vendors.create',
        'vendors.update',
        'vendors.delete',
        'expenses.read',
        'expenses.create',
        'expenses.update',
        'expenses.delete',
        'expenses.approve',
        'expenses.pay',
        'orders.read',
        'orders.create',
        'orders.update',
        'orders.fulfill',
        'purchase_orders.read',
        'purchase_orders.create',
        'purchase_orders.update',
        'purchase_orders.approve',
        'sales_invoices.read',
        'sales_invoices.create',
        'sales_invoices.update',
        'sales_invoices.pay',
        'licenses.read',
        'licenses.manage',
        'withholding_tax_types.read',
        'withholding_tax_types.create',
        'withholding_tax_types.update',
        'reports.read',
        'reports.generate',
        'reports.delete',
        'settings.update',
        'profile.manage',
      ];

      await queryInterface.sequelize.query(
        `
        DELETE rp
        FROM role_permissions rp
        INNER JOIN roles r ON r.id = rp.role_id
        INNER JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code IN (:roleCodes)
          AND p.code IN (:permissionCodes)
      `,
        {
          replacements: { roleCodes, permissionCodes },
          transaction,
        }
      );

      await queryInterface.bulkDelete('permissions', { code: permissionCodes }, { transaction });
      await queryInterface.bulkDelete('roles', { code: roleCodes }, { transaction });

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },
};
