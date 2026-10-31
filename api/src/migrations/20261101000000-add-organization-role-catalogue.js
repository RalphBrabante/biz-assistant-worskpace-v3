'use strict';
const { ensureIndex } = require('../database/resumable-index');

// MySQL DDL commits immediately, so every step tolerates a previously interrupted run.
async function addMissingColumns(q, table, columns) {
  const existing = await q.describeTable(table);
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing[name]) await q.addColumn(table, name, definition);
  }
}

module.exports = {
  async up(q, S) {
    const userRef = () => ({
      type: S.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await addMissingColumns(q, 'organization_roles', {
      // Set on the roles every organization owns (administrator, accountant, ...). NULL means a custom role.
      preset_code: { type: S.STRING(50), allowNull: true },
      // Provenance for custom global roles copied into an organization by the backfill.
      legacy_role_id: {
        type: S.UUID,
        allowNull: true,
        references: { model: 'roles', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_by_user_id: userRef(),
      updated_by_user_id: userRef(),
    });
    await ensureIndex(q, 'organization_roles', ['organization_id', 'preset_code'], { unique: true, name: 'organization_roles_preset' });
    // The target of the composite foreign key that keeps assignments inside their organization.
    await ensureIndex(q, 'organization_roles', ['organization_id', 'id'], { unique: true, name: 'organization_roles_tenant_key' });

    await addMissingColumns(q, 'organization_user_roles', { assigned_by_user_id: userRef() });
    await ensureIndex(q, 'organization_user_roles', ['user_id', 'organization_id'], { name: 'organization_user_roles_member' });

    const tables = await q.showAllTables();
    if (!tables.includes('organization_role_audit_logs')) {
      await q.createTable('organization_role_audit_logs', {
        id: { type: S.UUID, allowNull: false, primaryKey: true },
        organization_id: {
          type: S.UUID,
          allowNull: false,
          references: { model: 'organizations', key: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        actor_user_id: userRef(),
        action: { type: S.STRING(60), allowNull: false },
        // Plain values rather than foreign keys: the history outlives the role or user it describes.
        role_id: { type: S.UUID, allowNull: true },
        role_name: { type: S.STRING(100), allowNull: true },
        target_user_id: { type: S.UUID, allowNull: true },
        details: { type: S.JSON, allowNull: true },
        created_at: { type: S.DATE, allowNull: false },
      });
    }
    await ensureIndex(q, 'organization_role_audit_logs', ['organization_id', 'created_at'], { name: 'organization_role_audit_logs_recent' });
  },

  async down(q) {
    await q.dropTable('organization_role_audit_logs');
    // The user_id foreign key relies on this index once MySQL has dropped its own, so it needs a replacement first.
    await ensureIndex(q, 'organization_user_roles', ['user_id'], { name: 'organization_user_roles_user_id' });
    await q.removeIndex('organization_user_roles', 'organization_user_roles_member');
    await q.removeColumn('organization_user_roles', 'assigned_by_user_id');
    await q.removeIndex('organization_roles', 'organization_roles_tenant_key');
    await q.removeIndex('organization_roles', 'organization_roles_preset');
    for (const column of ['updated_by_user_id', 'created_by_user_id', 'legacy_role_id', 'preset_code']) {
      await q.removeColumn('organization_roles', column);
    }
  },
};
