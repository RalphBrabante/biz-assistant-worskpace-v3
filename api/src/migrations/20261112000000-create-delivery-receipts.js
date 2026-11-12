'use strict';
module.exports = {
  async up(q, S) {
    if ((await q.showAllTables()).includes('delivery_receipts')) return;
    await q.createTable('delivery_receipts', {
      id: { type: S.UUID, allowNull: false, primaryKey: true },
      organization_id: { type: S.UUID, allowNull: false, references: { model: 'organizations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      order_id: { type: S.UUID, allowNull: false, references: { model: 'orders', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      receipt_number: { type: S.STRING(50), allowNull: false },
      delivery_date: { type: S.DATEONLY, allowNull: false },
      status: { type: S.STRING(16), allowNull: false, defaultValue: 'issued' },
      receipt_document: { type: S.JSON, allowNull: true },
      void_reason: { type: S.TEXT, allowNull: true },
      voided_at: { type: S.DATE, allowNull: true },
      voided_by: { type: S.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_by: { type: S.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: S.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn('NOW') },
    });
    // Booklet numbers are unique per organization, including voided receipts.
    await q.addIndex('delivery_receipts', ['organization_id', 'receipt_number'], { unique: true, name: 'delivery_receipts_org_number' });
    await q.addIndex('delivery_receipts', ['order_id', 'created_at'], { name: 'delivery_receipts_order_created' });
  },
  async down(q) { await q.dropTable('delivery_receipts'); },
};
