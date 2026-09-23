const { DataTypes, Model } = require('sequelize');

class BugReport extends Model {}

function initBugReportModel(sequelize) {
  BugReport.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    updatedBy: { type: DataTypes.UUID, allowNull: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    steps: { type: DataTypes.TEXT, allowNull: true },
    expectedResult: { type: DataTypes.TEXT, allowNull: true },
    pagePath: { type: DataTypes.STRING(500), allowNull: false },
    status: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'open' },
  }, {
    sequelize, modelName: 'BugReport', tableName: 'bug_reports', timestamps: true, underscored: true,
    indexes: [
      { fields: ['organization_id', 'status', 'created_at'], name: 'bug_reports_org_status_created' },
      { fields: ['created_at'], name: 'bug_reports_created' },
    ],
  });
  return BugReport;
}

module.exports = { BugReport, initBugReportModel };
