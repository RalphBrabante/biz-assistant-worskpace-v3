const { indexesFor } = require('../database/schema-indexes-v1');
const { DataTypes, Model } = require('sequelize');

class SalesInvoice extends Model {}
async function protectOrderInvoice(invoice, options) {
  if (options.orderWorkflow) return;
  const orderId = invoice.orderId || invoice.previous('orderId');
  if (!orderId) return;
  const order = await invoice.sequelize.models.Order.findByPk(orderId, { transaction: options.transaction });
  if (order?.workflow) throw new Error('Manage this invoice through its order workspace to preserve financial history.');
}

function initSalesInvoiceModel(sequelize) {
  SalesInvoice.init(
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
      orderId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      invoiceNumber: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      issueDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('draft', 'issued', 'sent', 'paid', 'partially_paid', 'overdue', 'void'),
        allowNull: false,
        defaultValue: 'draft',
      },
      paymentStatus: {
        type: DataTypes.ENUM('unpaid', 'partially_paid', 'paid', 'refunded', 'failed'),
        allowNull: false,
        defaultValue: 'unpaid',
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'USD',
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      taxableAmount: {
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
      scPwdDiscount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      serviceCharge: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      totalAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
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
      modelName: 'SalesInvoice',
      hooks: { beforeCreate: protectOrderInvoice, beforeUpdate: protectOrderInvoice, beforeDestroy: protectOrderInvoice },
      tableName: 'sales_invoices',
      timestamps: true,
      underscored: true,
      indexes: [
        ...indexesFor('sales_invoices'),
        { fields: ['order_id'] },
        { unique: true, fields: ['organization_id', 'invoice_number'] },
        { fields: ['organization_id'] },
        { fields: ['status'] },
        { fields: ['payment_status'] },
        { fields: ['withholding_tax_type_id'] },
        { fields: ['issue_date'] },
        { fields: ['due_date'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
      ],
    }
  );

  return SalesInvoice;
}

module.exports = {
  SalesInvoice,
  initSalesInvoiceModel,
};
