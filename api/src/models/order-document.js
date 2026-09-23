const { DataTypes, Model } = require('sequelize');
class OrderDocument extends Model {}
function initOrderDocumentModel(sequelize) {
  OrderDocument.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orderId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(180), allowNull: false },
    mimeType: { type: DataTypes.STRING(80), allowNull: false },
    size: { type: DataTypes.INTEGER, allowNull: false },
    content: { type: DataTypes.BLOB('medium'), allowNull: false },
  }, { sequelize, modelName: 'OrderDocument', tableName: 'order_documents', underscored: true,
    defaultScope: { attributes: { exclude: ['content'] } } });
  return OrderDocument;
}
module.exports = { OrderDocument, initOrderDocumentModel };
