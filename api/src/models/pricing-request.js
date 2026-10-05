const { DataTypes, Model } = require('sequelize');
class PricingRequest extends Model {}
class PricingRequestLimit extends Model {}
function initPricingRequestModels(sequelize) {
  PricingRequest.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    requestKeyHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    dedupeHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    payloadHash: { type: DataTypes.STRING(64), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    email: { type: DataTypes.STRING(254), allowNull: false },
    firmName: { type: DataTypes.STRING(160), allowNull: true },
    marketingConsent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    catalogueVersion: { type: DataTypes.STRING(80), allowNull: false },
    selectionSnapshot: { type: DataTypes.JSON, allowNull: false },
  }, { sequelize, modelName: 'PricingRequest', tableName: 'pricing_requests', underscored: true, timestamps: true, indexes: [{ fields: ['created_at'] }] });
  PricingRequestLimit.init({
    id: { type: DataTypes.STRING(64), primaryKey: true },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, modelName: 'PricingRequestLimit', tableName: 'pricing_request_limits', underscored: true, timestamps: false, indexes: [{ fields: ['expires_at'] }] });
}
module.exports = { PricingRequest, PricingRequestLimit, initPricingRequestModels };
