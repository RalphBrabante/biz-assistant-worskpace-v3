const { DataTypes, Model } = require('sequelize');
class ChatMessage extends Model {}

function initChatMessageModel(sequelize) {
  ChatMessage.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    senderUserId: { type: DataTypes.UUID, allowNull: false },
    recipientUserId: { type: DataTypes.UUID, allowNull: false },
    clientMessageId: { type: DataTypes.UUID, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false, validate: { len: [1, 4000] } },
    readAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
    updatedAt: { type: DataTypes.DATE(3), allowNull: false },
  }, {
    sequelize, modelName: 'ChatMessage', tableName: 'chat_messages', timestamps: true, underscored: true,
    indexes: [
      { name: 'chat_messages_retry_unique', unique: true, fields: ['organization_id', 'sender_user_id', 'client_message_id'] },
      { name: 'chat_messages_history', fields: ['organization_id', 'sender_user_id', 'recipient_user_id', 'created_at', 'id'] },
      { name: 'chat_messages_incoming_history', fields: ['organization_id', 'recipient_user_id', 'sender_user_id', 'created_at', 'id'] },
      { name: 'chat_messages_unread', fields: ['organization_id', 'recipient_user_id', 'read_at', 'sender_user_id'] },
    ],
  });
  return ChatMessage;
}
module.exports = { ChatMessage, initChatMessageModel };
