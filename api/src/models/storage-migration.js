const { DataTypes, Model } = require('sequelize');

// MariaDB exposes JSON as LONGTEXT through the MySQL driver. Decode persisted
// snapshots on access, while retaining native MySQL JSON objects on writes.
function jsonObject(attribute, allowNull = false) {
  return { type: DataTypes.JSON, allowNull, get() {
    const stored = this.getDataValue(attribute);
    if (stored === undefined) return stored; // Attribute was not selected.
    const value = typeof stored === 'string' ? JSON.parse(stored) : stored;
    if (value === null && allowNull) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid storage migration JSON object: ${attribute}`);
    }
    return value;
  } };
}

class StorageMigration extends Model {}
class StorageMigrationItem extends Model {}
function initStorageMigrationModels(sequelize) {
  StorageMigration.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'ready' },
    source: jsonObject('source'),
    destination: { type: DataTypes.STRING(1024), allowNull: false },
    previousProviders: jsonObject('previousProviders'),
    createdBy: { type: DataTypes.UUID, allowNull: true },
    switchedAt: { type: DataTypes.DATE, allowNull: true },
  }, { sequelize, modelName: 'StorageMigration', tableName: 'storage_migrations', underscored: true });
  StorageMigrationItem.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    migrationId: { type: DataTypes.UUID, allowNull: false },
    entityType: { type: DataTypes.STRING(40), allowNull: false },
    entityId: { type: DataTypes.UUID, allowNull: false },
    referenceHash: { type: DataTypes.STRING(64), allowNull: false },
    before: jsonObject('before'),
    after: jsonObject('after', true),
    objects: jsonObject('objects'),
    verification: jsonObject('verification', true),
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
    error: { type: DataTypes.TEXT, allowNull: true },
  }, { sequelize, modelName: 'StorageMigrationItem', tableName: 'storage_migration_items', underscored: true,
    indexes: [{ unique: true, fields: ['migration_id', 'reference_hash'], name: 'storage_migration_reference_uq' },
      { fields: ['migration_id', 'status', 'id'], name: 'storage_migration_pending_idx' }] });
}
module.exports = { StorageMigration, StorageMigrationItem, initStorageMigrationModels };
