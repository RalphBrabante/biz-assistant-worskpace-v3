const { DataTypes, Model } = require('sequelize');

class OrderItemSnapshot extends Model {}

function initOrderItemSnapshotModel(sequelize) {
  OrderItemSnapshot.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      orderId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      itemId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      sku: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(180),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM('product', 'service'),
        allowNull: false,
        defaultValue: 'product',
      },
      unit: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'each',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      unitPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discountedUnitPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      taxRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      quantity: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
        defaultValue: 1.0,
      },
      lineSubtotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      lineDiscount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      lineTax: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      lineTotal: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'OrderItemSnapshot',
      tableName: 'order_item_snapshots',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['order_id'] },
        { fields: ['item_id'] },
        { fields: ['name'] },
      ],
    }
  );

  return OrderItemSnapshot;
}

module.exports = {
  OrderItemSnapshot,
  initOrderItemSnapshotModel,
};
