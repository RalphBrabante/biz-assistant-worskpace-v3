const { indexesFor } = require('../database/schema-indexes-v1');
const { DataTypes, Model } = require('sequelize');

class Order extends Model {}

function initOrderModel(sequelize) {
  Order.init(
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
      orderNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      customerId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      workflow: { type: DataTypes.JSON, allowNull: true },
      revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      requestKey: { type: DataTypes.UUID, allowNull: true },
      customerPoNumber: { type: DataTypes.STRING(120), allowNull: true },
      promisedDate: { type: DataTypes.DATEONLY, allowNull: true },
      invoicingStatus: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'not_invoiced' },
      source: {
        type: DataTypes.ENUM('web', 'mobile', 'in_store', 'admin', 'api'),
        allowNull: false,
        defaultValue: 'web',
      },
      status: {
        type: DataTypes.ENUM(
          'draft',
          'pending',
          'confirmed',
          'processing',
          'completed',
          'cancelled',
          'refunded'
        ),
        allowNull: false,
        defaultValue: 'pending',
      },
      paymentStatus: {
        type: DataTypes.ENUM('unpaid', 'partially_paid', 'paid', 'refunded', 'failed'),
        allowNull: false,
        defaultValue: 'unpaid',
      },
      fulfillmentStatus: {
        type: DataTypes.ENUM('unfulfilled', 'partially_fulfilled', 'fulfilled'),
        allowNull: false,
        defaultValue: 'unfulfilled',
      },
      orderDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
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
      withHoldingTaxAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      withholdingTaxTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
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
      billingAddress: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      shippingAddress: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      paidAt: {
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
      modelName: 'Order',
      tableName: 'orders',
      timestamps: true,
      underscored: true,
      hooks: {
        beforeUpdate: (order) => {
          if (order.changed('orderNumber')) {
            throw new Error('orderNumber is immutable and cannot be updated.');
          }
        },
      },
      indexes: [
        ...indexesFor('orders'),
        { unique: true, fields: ['organization_id', 'order_number'] },
        { unique: true, fields: ['organization_id', 'request_key'] },
        { fields: ['organization_id'] },
        { fields: ['user_id'] },
        { fields: ['customer_id'] },
        { fields: ['status'] },
        { fields: ['payment_status'] },
        { fields: ['fulfillment_status'] },
        { fields: ['with_holding_tax_amount'] },
        { fields: ['withholding_tax_type_id'] },
        { fields: ['order_date'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
      ],
    }
  );

  return Order;
}

module.exports = {
  Order,
  initOrderModel,
};
