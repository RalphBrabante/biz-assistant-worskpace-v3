const { DataTypes, Model } = require('sequelize');

class UserRole extends Model {}

function initUserRoleModel(sequelize) {
  UserRole.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      roleId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      assignedByUserId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'UserRole',
      tableName: 'user_roles',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['role_id'] },
        { unique: true, fields: ['user_id', 'role_id'] },
      ],
    }
  );

  return UserRole;
}

module.exports = {
  UserRole,
  initUserRoleModel,
};
