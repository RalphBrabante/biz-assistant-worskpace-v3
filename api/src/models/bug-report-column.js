const { DataTypes, Model } = require('sequelize');
class BugReportColumn extends Model {}

function initBugReportColumnModel(sequelize) {
  BugReportColumn.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    color: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'violet' },
    createdBy: { type: DataTypes.UUID, allowNull: true },
  }, {
    sequelize, modelName: 'BugReportColumn', tableName: 'bug_report_columns', timestamps: true, underscored: true,
    indexes: [{ unique: true, fields: ['organization_id', 'name'], name: 'bug_report_columns_org_name' }],
  });
  return BugReportColumn;
}
module.exports = { BugReportColumn, initBugReportColumnModel };
