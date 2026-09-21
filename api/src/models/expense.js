const { indexesFor } = require('../database/schema-indexes-v1');
const { DataTypes, Model } = require('sequelize');

class Expense extends Model {}

function initExpenseModel(sequelize) {
  Expense.init(
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
      vendorTaxId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      expenseNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      vatExemptAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      receiptVatAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      withholdingTaxBase: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
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
      category: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      expenseDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('draft', 'submitted', 'approved', 'paid', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      paymentMethod: {
        type: DataTypes.ENUM('cash', 'bank_transfer', 'credit_card', 'check', 'other'),
        allowNull: false,
        defaultValue: 'bank_transfer',
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
      taxAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      taxTypeId: {
        type: DataTypes.UUID,
        allowNull: true,
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
      receiptUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      file: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      fileCdnUrl: {
        type: DataTypes.STRING(1000),
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
      approvedBy: {
        type: DataTypes.UUID,
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
      modelName: 'Expense',
      tableName: 'expenses',
      timestamps: true,
      underscored: true,
      indexes: [
        ...indexesFor('expenses'),
        { unique: true, fields: ['organization_id', 'expense_number'] },
        { fields: ['organization_id'] },
        { fields: ['vendor_id'] },
        { fields: ['vendor_tax_id'] },
        { fields: ['taxable_amount'] },
        { fields: ['tax_type_id'] },
        { fields: ['withholding_tax_type_id'] },
        { fields: ['status'] },
        { fields: ['expense_date'] },
        { fields: ['due_date'] },
        { fields: ['approved_by'] },
        { fields: ['created_by'] },
        { fields: ['updated_by'] },
      ],
    }
  );

  return Expense;
}

module.exports = {
  Expense,
  initExpenseModel,
};
