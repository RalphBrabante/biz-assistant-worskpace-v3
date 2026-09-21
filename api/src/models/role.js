const { DataTypes, Model } = require('sequelize');

class Role extends Model {}

function initRoleModel(sequelize) {
  Role.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isSystem: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'Role',
      tableName: 'roles',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['name'] },
        { unique: true, fields: ['code'] },
      ],
    }
  );

  return Role;
}

module.exports = {
  Role,
  initRoleModel,
};
