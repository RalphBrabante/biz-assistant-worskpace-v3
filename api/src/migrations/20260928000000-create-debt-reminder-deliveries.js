'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('debt_reminder_deliveries', {
      organization_id: {type: S.UUID, allowNull: false, primaryKey: true, references: {model: 'organizations', key: 'id'}, onDelete: 'CASCADE'},
      reminder_date: {type: S.DATEONLY, allowNull: false, primaryKey: true},
      sent_at: {type: S.DATE, allowNull: true},
    });
  },
  async down(q) {await q.dropTable('debt_reminder_deliveries');},
};
