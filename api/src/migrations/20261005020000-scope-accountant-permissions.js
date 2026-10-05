'use strict';
const { randomUUID } = require('crypto');
const { ACCOUNTANT_PERMISSIONS } = require('../services/accountant-access');

module.exports = {
  async up(q) {
    await q.sequelize.transaction(async transaction => {
      const options = { transaction };
      const now = new Date();
      const [customers] = await q.sequelize.query("SELECT id FROM permissions WHERE code = 'customers.read'", options);
      if (!customers.length) await q.bulkInsert('permissions', [{
        id: randomUUID(), code: 'customers.read', name: 'Read Customers', resource: 'customers', action: 'read',
        is_system: true, is_active: true, created_at: now, updated_at: now,
      }], options);
      const [roles] = await q.sequelize.query("SELECT id FROM roles WHERE code = 'accountant'", options);
      if (!roles.length) return; // Fresh installations receive the preset through the seed.
      const [permissions] = await q.sequelize.query('SELECT id, code FROM permissions WHERE is_active = 1', options);
      await q.bulkDelete('role_permissions', { role_id: roles[0].id }, options);
      const allowed = permissions.filter(p => ACCOUNTANT_PERMISSIONS.includes(p.code));
      if (allowed.length) await q.bulkInsert('role_permissions', allowed.map(p => ({
        id: randomUUID(), role_id: roles[0].id, permission_id: p.id, is_allowed: true,
        is_active: true, assigned_at: now, created_at: now, updated_at: now,
      })), options);
    });
  },
  // Keep the security reduction on rollback; restoring historical write grants
  // would silently expand accountant access. System permissions are retained.
  async down() {},
};
