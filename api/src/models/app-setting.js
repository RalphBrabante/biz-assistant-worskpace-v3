const { DataTypes, Model } = require('sequelize');

class AppSetting extends Model {}

function initAppSettingModel(sequelize) {
  AppSetting.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      valueBoolean: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      valueText: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AppSetting',
      tableName: 'app_settings',
      timestamps: true,
      underscored: true,
      indexes: [{ name: 'app_settings_key_uq', unique: true, fields: ['key'] }, { fields: ['updated_by'] }],
    }
  );

  return AppSetting;
}

module.exports = {
  AppSetting,
  initAppSettingModel,
};
