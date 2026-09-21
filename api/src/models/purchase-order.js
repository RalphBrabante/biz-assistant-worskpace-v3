const { DataTypes, Model } = require('sequelize');

class PurchaseOrder extends Model {}

function initPurchaseOrderModel(sequelize) {
  PurchaseOrder.init(
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
      poNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      vendorName: {
        type: DataTypes.STRING(180),
        allowNull: false,
      },
      vendorEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      vendorPhone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      billingAddress: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      shippingAddress: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      orderDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      expectedDeliveryDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          'draft',
          'submitted',
          'approved',
          'partially_received',
          'received',
          'cancelled'
        ),
        allowNull: false,
        defaultValue: 'draft',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      subtotalAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      taxAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discountAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      shippingAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      totalAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      paymentTerms: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      approvedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      approvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PurchaseOrder',
      tableName: 'purchase_orders',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['organization_id', 'po_number'] },
        { fields: ['status'] },
        { fields: ['order_date'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
        { fields: ['approved_by'] },
      ],
    }
  );

  return PurchaseOrder;
}

module.exports = {
  PurchaseOrder,
  initPurchaseOrderModel,
};
