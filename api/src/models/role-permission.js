const { DataTypes, Model } = require('sequelize');

class RolePermission extends Model {}

function initRolePermissionModel(sequelize) {
  RolePermission.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      permissionId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      isAllowed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      scope: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      constraints: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      assignedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'RolePermission',
      tableName: 'role_permissions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['role_id'] },
        { fields: ['permission_id'] },
        { unique: true, fields: ['role_id', 'permission_id'] },
      ],
    }
  );

  return RolePermission;
}

module.exports = {
  RolePermission,
  initRolePermissionModel,
};
