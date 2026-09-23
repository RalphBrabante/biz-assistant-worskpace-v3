const { DataTypes, Model } = require('sequelize');
class OrderDocumentUpload extends Model {}
function initOrderDocumentUploadModel(sequelize) {
  OrderDocumentUpload.init({
    id: { type: DataTypes.UUID, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    targetOrderId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    mimeType: { type: DataTypes.STRING(80), allowNull: false },
    size: { type: DataTypes.INTEGER, allowNull: false },
    content: { type: DataTypes.BLOB('medium'), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, modelName: 'OrderDocumentUpload', tableName: 'order_document_uploads', underscored: true,
    defaultScope: { attributes: { exclude: ['content'] } } });
  return OrderDocumentUpload;
}
module.exports = { OrderDocumentUpload, initOrderDocumentUploadModel };
