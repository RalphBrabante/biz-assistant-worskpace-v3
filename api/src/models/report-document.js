const { DataTypes, Model } = require('sequelize');
class ReportDocument extends Model {}
function initReportDocumentModel(sequelize) {
  ReportDocument.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    documentCode: { type: DataTypes.STRING(30), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    year: { type: DataTypes.INTEGER, allowNull: false },
    quarter: { type: DataTypes.INTEGER, allowNull: true },
    filename: { type: DataTypes.STRING(255), allowNull: false },
    byteLength: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    sha256: { type: DataTypes.STRING(64), allowNull: false },
    sourceRevision: { type: DataTypes.STRING(128), allowNull: false },
    pdfContent: { type: DataTypes.BLOB('long'), allowNull: false },
    generatedBy: { type: DataTypes.UUID, allowNull: true },
    generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { sequelize, modelName: 'ReportDocument', tableName: 'report_documents', timestamps: true, underscored: true,
    indexes: [{ fields: ['organization_id', 'year', 'generated_at'], name: 'report_documents_org_year_generated' }] });
  return ReportDocument;
}
module.exports = { ReportDocument, initReportDocumentModel };
