const { DataTypes, Model } = require('sequelize');
class StorageMigration extends Model {}
class StorageMigrationItem extends Model {}
function initStorageMigrationModels(sequelize) {
  StorageMigration.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'ready' },
    source: { type: DataTypes.JSON, allowNull: false },
    destination: { type: DataTypes.STRING(1024), allowNull: false },
    previousProviders: { type: DataTypes.JSON, allowNull: false },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    switchedAt: { type: DataTypes.DATE, allowNull: true },
  }, { sequelize, modelName: 'StorageMigration', tableName: 'storage_migrations', underscored: true });
  StorageMigrationItem.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    migrationId: { type: DataTypes.UUID, allowNull: false },
    entityType: { type: DataTypes.STRING(40), allowNull: false },
    entityId: { type: DataTypes.UUID, allowNull: false },
    referenceHash: { type: DataTypes.STRING(64), allowNull: false },
    before: { type: DataTypes.JSON, allowNull: false },
    after: { type: DataTypes.JSON, allowNull: true },
    objects: { type: DataTypes.JSON, allowNull: false },
    verification: { type: DataTypes.JSON, allowNull: true },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
    error: { type: DataTypes.TEXT, allowNull: true },
  }, { sequelize, modelName: 'StorageMigrationItem', tableName: 'storage_migration_items', underscored: true,
    indexes: [{ unique: true, fields: ['migration_id', 'reference_hash'], name: 'storage_migration_reference_uq' },
      { fields: ['migration_id', 'status', 'id'], name: 'storage_migration_pending_idx' }] });
}
module.exports = { StorageMigration, StorageMigrationItem, initStorageMigrationModels };
