const { DataTypes, Model } = require('sequelize');

class Item extends Model {}

function initItemModel(sequelize) {
  Item.init(
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
      vendorId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      type: {
        type: DataTypes.ENUM('product', 'service'),
        allowNull: false,
        defaultValue: 'product',
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
      category: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      unit: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'each',
      },
      price: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      cost: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      discountedPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      stock: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      reorderLevel: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      taxRate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      modelName: 'Item',
      tableName: 'items',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['organization_id'] },
        { fields: ['vendor_id'] },
        { fields: ['type'] },
        { fields: ['name'] },
        { fields: ['sku'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
      ],
    }
  );

  return Item;
}

module.exports = {
  Item,
  initItemModel,
};
