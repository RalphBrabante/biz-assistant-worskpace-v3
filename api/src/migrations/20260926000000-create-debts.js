'use strict';
const {randomUUID} = require('crypto');
module.exports = {
  async up(q, S) {
    const id = () => ({type: S.UUID, primaryKey: true, allowNull: false});
    const ref = (table, nullable = false) => ({type: S.UUID, allowNull: nullable, references: {model: table, key: 'id'}, onUpdate: 'CASCADE', onDelete: nullable ? 'SET NULL' : 'CASCADE'});
    const required = type => ({type, allowNull: false});
    const timestamps = () => ({created_at: required(S.DATE), updated_at: required(S.DATE)});
    await q.createTable('debts', {
      id: id(), organization_id: ref('organizations'), title: required(S.STRING(200)), creditor: required(S.STRING(200)),
      original_amount: required(S.DECIMAL(14, 2)), paid_amount: {...required(S.DECIMAL(14, 2)), defaultValue: '0.00'},
      currency: required(S.STRING(3)), borrowed_on: required(S.DATEONLY), due_on: S.DATEONLY, notes: S.TEXT,
      created_by: ref('users', true), request_key: required(S.UUID), ...timestamps(),
    });
    await q.addIndex('debts', ['organization_id', 'created_at'], {name: 'debts_org_created'});
    await q.addIndex('debts', ['organization_id', 'request_key'], {name: 'debts_org_request', unique: true});
    await q.createTable('debt_payments', {
      id: id(), organization_id: ref('organizations'), debt_id: ref('debts'), amount: required(S.DECIMAL(14, 2)),
      paid_on: required(S.DATEONLY), reference: S.STRING(200), notes: S.TEXT, created_by: ref('users', true), request_key: required(S.UUID), ...timestamps(),
    });
    await q.addIndex('debt_payments', ['organization_id', 'debt_id', 'paid_on'], {name: 'debt_payments_scope_date'});
    await q.addIndex('debt_payments', ['debt_id', 'request_key'], {name: 'debt_payments_request', unique: true});
    const [existing] = await q.sequelize.query("SELECT code FROM permissions WHERE code IN ('debts.read', 'debts.create', 'debts.pay')");
    const now = new Date();
    const actions = ['read', 'create', 'pay'].filter(action => !existing.some(row => row.code === `debts.${action}`));
    if (actions.length) await q.bulkInsert('permissions', actions.map(action => ({id: randomUUID(), name: `Debts: ${action}`, code: `debts.${action}`, resource: 'debts', action, description: `Debt management: ${action}`, is_system: true, is_active: true, created_at: now, updated_at: now})));
  },
  async down(q) {
    await q.dropTable('debt_payments'); await q.dropTable('debts');
    // System permissions and role grants are retained, as required by their protection triggers.
  },
};
