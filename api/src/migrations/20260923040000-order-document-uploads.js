'use strict';
module.exports = {
  async up(q, S) {
    if (!(await q.showAllTables()).includes('order_document_uploads')) {
      const reference = model => ({ type: S.UUID, allowNull: false, references: { model, key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' });
      await q.createTable('order_document_uploads', {
        id: { type: S.UUID, primaryKey: true, allowNull: false },
        organization_id: reference('organizations'), user_id: reference('users'),
        target_order_id: { ...reference('orders'), allowNull: true },
        name: { type: S.STRING(180), allowNull: false }, mime_type: { type: S.STRING(80), allowNull: false },
        size: { type: S.INTEGER, allowNull: false }, content: { type: S.BLOB('medium'), allowNull: false },
        expires_at: { type: S.DATE, allowNull: false },
        created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
      });
    }
    const indexes = await q.showIndex('order_document_uploads');
    if (!indexes.some(i => i.name === 'order_uploads_expiry')) await q.addIndex('order_document_uploads', ['expires_at'], { name: 'order_uploads_expiry' });
    if (!indexes.some(i => i.name === 'order_uploads_owner')) await q.addIndex('order_document_uploads', ['user_id', 'organization_id'], { name: 'order_uploads_owner' });
  },
  async down(q) { await q.dropTable('order_document_uploads'); },
};
