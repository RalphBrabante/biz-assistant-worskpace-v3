const { DataTypes, Model } = require('sequelize');
const { jsonObjectAttribute } = require('./json-object-attribute');

// Optional delivery receipt (DR) issued from a workflow-managed order. The
// printed details are frozen in receiptDocument at issue time.
class DeliveryReceipt extends Model {}
function initDeliveryReceiptModel(sequelize) {
  DeliveryReceipt.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    orderId: { type: DataTypes.UUID, allowNull: false },
    receiptNumber: { type: DataTypes.STRING(50), allowNull: false },
    deliveryDate: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'issued' },
    receiptDocument: jsonObjectAttribute('receiptDocument'),
    voidReason: { type: DataTypes.TEXT, allowNull: true },
    voidedAt: { type: DataTypes.DATE, allowNull: true },
    voidedBy: { type: DataTypes.UUID, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    updatedBy: { type: DataTypes.UUID, allowNull: true },
  }, { sequelize, modelName: 'DeliveryReceipt', tableName: 'delivery_receipts', underscored: true });
  return DeliveryReceipt;
}
module.exports = { DeliveryReceipt, initDeliveryReceiptModel };
