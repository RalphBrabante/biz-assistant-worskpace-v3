const {DataTypes:D, Model} = require('sequelize');
class BankAccount extends Model {}
class BankOperation extends Model {}
class BankEntry extends Model {}
function initBankModels(sequelize) {
  const required = type => ({type,allowNull:false});
  const id = () => ({...required(D.UUID),primaryKey:true,defaultValue:D.UUIDV4});
  const options = (modelName,tableName) => ({sequelize,modelName,tableName,timestamps:true,underscored:true});
  BankAccount.init({id:id(),organizationId:required(D.UUID),name:required(D.STRING(120)),bankName:required(D.STRING(120)),lastFour:D.STRING(4),currency:required(D.STRING(3)),balance:{...required(D.DECIMAL(14,2)),defaultValue:'0.00'},isArchived:{...required(D.BOOLEAN),defaultValue:false},notes:D.TEXT},options('BankAccount','bank_accounts'));
  BankOperation.init({id:id(),organizationId:required(D.UUID),requestKey:required(D.UUID),fingerprint:required(D.STRING(64)),kind:required(D.STRING(20)),reversalOf:D.UUID,createdBy:D.UUID},options('BankOperation','bank_operations'));
  BankEntry.init({id:{type:D.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true},organizationId:required(D.UUID),accountId:required(D.UUID),operationId:required(D.UUID),kind:required(D.STRING(20)),direction:required(D.STRING(10)),amount:required(D.DECIMAL(14,2)),balanceAfter:required(D.DECIMAL(14,2)),postedOn:required(D.DATEONLY),reference:D.STRING(200),notes:D.TEXT},options('BankEntry','bank_entries'));
}
module.exports={BankAccount,BankOperation,BankEntry,initBankModels};
