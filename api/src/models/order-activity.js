const { jsonObjectAttribute } = require('./json-object-attribute');
const { indexesFor } = require('../database/schema-indexes-v1');
const { DataTypes, Model } = require('sequelize');

class OrderActivity extends Model {}

function initOrderActivityModel(sequelize) {
  OrderActivity.init(
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
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      actionType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      changedFields: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      metadata: jsonObjectAttribute('metadata'),
    },
    {
      sequelize,
      modelName: 'OrderActivity',
      tableName: 'order_activities',
      timestamps: true,
      underscored: true,
      indexes: [
        ...indexesFor('order_activities'),
        { fields: ['order_id'] },
        { fields: ['organization_id'] },
        { fields: ['user_id'] },
        { fields: ['action_type'] },
        { fields: ['created_at'] },
      ],
    }
  );

  return OrderActivity;
}

module.exports = {
  OrderActivity,
  initOrderActivityModel,
};
