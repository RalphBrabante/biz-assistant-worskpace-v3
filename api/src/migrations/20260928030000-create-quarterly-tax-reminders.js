'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('quarterly_tax_reminder_deliveries', {
      organization_id: {type: S.UUID, allowNull: false, primaryKey: true, references: {model: 'organizations', key: 'id'}, onDelete: 'CASCADE'},
      tax_year: {type: S.INTEGER, allowNull: false, primaryKey: true},
      quarter: {type: S.INTEGER, allowNull: false, primaryKey: true},
      recipient_hash: {type: S.STRING(64), allowNull: false, primaryKey: true},
      sent_at: {type: S.DATE, allowNull: true},
    });
  },
  async down(q) {await q.dropTable('quarterly_tax_reminder_deliveries');},
};
