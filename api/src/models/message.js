const { indexesFor } = require('../database/schema-indexes-v1');
const { DataTypes, Model } = require('sequelize');

class Message extends Model {}

function initMessageModel(sequelize) {
  Message.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      entityType: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Message',
      tableName: 'messages',
      timestamps: true,
      underscored: true,
      indexes: [
        ...indexesFor('messages'),
        { fields: ['organization_id'] },
        { fields: ['entity_type'] },
        { fields: ['entity_id'] },
        { fields: ['created_by'] },
        { fields: ['is_read'] },
        { fields: ['created_at'] },
      ],
    }
  );

  return Message;
}

module.exports = {
  Message,
  initMessageModel,
};

