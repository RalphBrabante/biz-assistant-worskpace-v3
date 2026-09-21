const { DataTypes, Model } = require('sequelize');

class InvalidLoginAttempt extends Model {}

function initInvalidLoginAttemptModel(sequelize) {
  InvalidLoginAttempt.init(
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
      attemptedEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },
      ipAddress: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      failureReason: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      attemptCountWindow: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 1,
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'InvalidLoginAttempt',
      tableName: 'invalid_login_attempts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['attempted_email'] },
        { fields: ['created_at'] },
      ],
    }
  );

  return InvalidLoginAttempt;
}

module.exports = {
  InvalidLoginAttempt,
  initInvalidLoginAttemptModel,
};
