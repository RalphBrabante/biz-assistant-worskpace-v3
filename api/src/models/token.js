const { DataTypes, Model } = require('sequelize');

class Token extends Model {}

function initTokenModel(sequelize) {
  Token.init(
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
      tokenHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('access', 'refresh', 'reset_password', 'verify_email', 'api_key'),
        allowNull: false,
        defaultValue: 'access',
      },
      scope: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revokedReason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
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
      modelName: 'Token',
      tableName: 'tokens',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['user_id'] },
        { unique: true, fields: ['token_hash'] },
        { fields: ['type'] },
        { fields: ['expires_at'] },
      ],
    }
  );

  return Token;
}

module.exports = {
  Token,
  initTokenModel,
};
