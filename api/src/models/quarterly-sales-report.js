const { DataTypes, Model } = require('sequelize');

class QuarterlySalesReport extends Model {}

function initQuarterlySalesReportModel(sequelize) {
  QuarterlySalesReport.init(
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
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      quarter: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },
      periodStart: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      periodEnd: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      invoiceCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      totalAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      generatedBy: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      generatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'QuarterlySalesReport',
      tableName: 'quarterly_sales_reports',
      timestamps: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ['organization_id', 'year', 'quarter'] },
        { fields: ['organization_id'] },
        { fields: ['year', 'quarter'] },
        { fields: ['generated_by'] },
      ],
    }
  );

  return QuarterlySalesReport;
}

module.exports = {
  QuarterlySalesReport,
  initQuarterlySalesReportModel,
};
