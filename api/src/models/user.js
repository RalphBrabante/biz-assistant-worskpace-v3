const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');

class User extends Model {}

function initUserModel(sequelize) {
  User.init(
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
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          isEmail: true,
        },
      },
      profileImageUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      profileImageCdnUrl: {
        type: DataTypes.STRING(1000),
        allowNull: true,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: true,
      },
      addressLine1: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      addressLine2: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      role: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'member',
      },
      status: {
        type: DataTypes.ENUM('pending_verification', 'active', 'suspended', 'invited'),
        allowNull: false,
        defaultValue: 'pending_verification',
      },
      isEmailVerified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      emailVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      timestamps: true,
      underscored: true,
      hooks: {
        beforeCreate: async (user) => {
          if (user.password) {
            user.password = await bcrypt.hash(user.password, 10);
          }
        },
        beforeUpdate: async (user) => {
          if (user.changed('password') && user.password) {
            user.password = await bcrypt.hash(user.password, 10);
          }
        },
      },
      indexes: [
        { fields: ['organization_id'] },
        { unique: true, fields: ['email'] },
        { fields: ['status'] },
      ],
    }
  );

  return User;
}

module.exports = {
  User,
  initUserModel,
};
