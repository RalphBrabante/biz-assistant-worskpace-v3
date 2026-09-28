'use strict';
const {randomUUID} = require('crypto');
module.exports = {
  async up(q) {
    const [rows] = await q.sequelize.query("SELECT id FROM permissions WHERE code = 'debts.delete'");
    if (rows.length) return;
    const now = new Date();
    await q.bulkInsert('permissions', [{id: randomUUID(), name: 'Debts: delete', code: 'debts.delete', resource: 'debts', action: 'delete', description: 'Delete debts and their payment history', is_system: true, is_active: true, created_at: now, updated_at: now}]);
  },
  async down() {
    // System permissions are retained to respect the database protection triggers.
  },
};
