const { DataTypes, Model } = require('sequelize');

class Permission extends Model {}

function initPermissionModel(sequelize) {
  Permission.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      resource: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'Permission',
      tableName: 'permissions',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['code'] },
        { fields: ['resource'] },
        { fields: ['action'] },
      ],
    }
  );

  return Permission;
}

module.exports = {
  Permission,
  initPermissionModel,
};
