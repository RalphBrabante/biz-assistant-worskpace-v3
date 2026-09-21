'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('storage_migrations', {
      id: { type: S.UUID, primaryKey: true, allowNull: false },
      status: { type: S.STRING(24), allowNull: false, defaultValue: 'ready' },
      source: { type: S.JSON, allowNull: false },
      destination: { type: S.STRING(1024), allowNull: false },
      previous_providers: { type: S.JSON, allowNull: false },
      created_by: { type: S.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      switched_at: { type: S.DATE, allowNull: true },
      created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
    });
    await q.createTable('storage_migration_items', {
      id: { type: S.UUID, primaryKey: true, allowNull: false },
      migration_id: { type: S.UUID, allowNull: false, references: { model: 'storage_migrations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      entity_type: { type: S.STRING(40), allowNull: false }, entity_id: { type: S.UUID, allowNull: false },
      reference_hash: { type: S.STRING(64), allowNull: false },
      before: { type: S.JSON, allowNull: false }, after: { type: S.JSON, allowNull: true },
      objects: { type: S.JSON, allowNull: false }, verification: { type: S.JSON, allowNull: true },
      status: { type: S.STRING(24), allowNull: false, defaultValue: 'pending' }, error: { type: S.TEXT, allowNull: true },
      created_at: { type: S.DATE, allowNull: false }, updated_at: { type: S.DATE, allowNull: false },
    });
    await q.addIndex('storage_migration_items', ['migration_id', 'reference_hash'], { unique: true, name: 'storage_migration_reference_uq' });
    await q.addIndex('storage_migration_items', ['migration_id', 'status', 'id'], { name: 'storage_migration_pending_idx' });
  },
  async down(q) {
    await q.dropTable('storage_migration_items');
    await q.dropTable('storage_migrations');
  },
};
