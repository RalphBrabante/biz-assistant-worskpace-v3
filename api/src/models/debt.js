const {DataTypes: D, Model} = require('sequelize');
class Debt extends Model {}
class DebtPayment extends Model {}
function initDebtModels(sequelize) {
  const id = () => ({type: D.UUID, primaryKey: true, defaultValue: D.UUIDV4});
  const required = type => ({type, allowNull: false});
  const options = (modelName, tableName, indexes) => ({sequelize, modelName, tableName, timestamps: true, underscored: true, indexes});
  Debt.init({
    id: id(), organizationId: required(D.UUID), title: required(D.STRING(200)), creditor: required(D.STRING(200)),
    originalAmount: required(D.DECIMAL(14, 2)), paidAmount: {...required(D.DECIMAL(14, 2)), defaultValue: '0.00'},
    currency: required(D.STRING(3)), borrowedOn: required(D.DATEONLY), dueOn: D.DATEONLY, notes: D.TEXT,
    createdBy: D.UUID, requestKey: required(D.UUID),
  }, options('Debt', 'debts', [{name: 'debts_org_created', fields: ['organization_id', 'created_at']}, {name: 'debts_org_request', unique: true, fields: ['organization_id', 'request_key']}]));
  DebtPayment.init({
    id: id(), organizationId: required(D.UUID), debtId: required(D.UUID), amount: required(D.DECIMAL(14, 2)),
    paidOn: required(D.DATEONLY), reference: D.STRING(200), notes: D.TEXT, createdBy: D.UUID, requestKey: required(D.UUID),
  }, options('DebtPayment', 'debt_payments', [{name: 'debt_payments_scope_date', fields: ['organization_id', 'debt_id', 'paid_on']}, {name: 'debt_payments_request', unique: true, fields: ['debt_id', 'request_key']}]));
}
module.exports = {Debt, DebtPayment, initDebtModels};
