const { DataTypes, Model } = require('sequelize');

class License extends Model {}

function initLicenseModel(sequelize) {
  License.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      key: {
        type: DataTypes.UUID,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        validate: {
          isUUID: 4,
        },
      },
      planName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('active', 'expired', 'revoked', 'suspended'),
        allowNull: false,
        defaultValue: 'active',
      },
      startsAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      maxUsers: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'License',
      tableName: 'licenses',
      timestamps: true,
      underscored: true,
      hooks: {
        beforeUpdate: (license) => {
          if (license.changed('key')) {
            throw new Error('License key is immutable and cannot be updated.');
          }
        },
      },
      indexes: [
        { fields: ['organization_id'] },
        { fields: ['expires_at'] },
        { fields: ['revoked_at'] },
        { unique: true, fields: ['key'] },
      ],
    }
  );

  return License;
}

module.exports = {
  License,
  initLicenseModel,
};
