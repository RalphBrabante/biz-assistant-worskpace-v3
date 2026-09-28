const {DataTypes:D,Model}=require('sequelize');
class Cheque extends Model {}
function initChequeModel(sequelize){
 const required=type=>({type,allowNull:false});
 Cheque.init({
  id:{...required(D.UUID),primaryKey:true,defaultValue:D.UUIDV4},organizationId:required(D.UUID),accountId:required(D.UUID),
  requestKey:required(D.UUID),fingerprint:required(D.STRING(64)),number:required(D.STRING(80)),payee:required(D.STRING(180)),amount:required(D.DECIMAL(14,2)),currency:required(D.STRING(3)),
  issuedOn:required(D.DATEONLY),datedOn:required(D.DATEONLY),reference:D.STRING(200),notes:D.TEXT,
  status:{...required(D.STRING(20)),defaultValue:'issued'},clearedOn:D.DATEONLY,returnedOn:D.DATEONLY,clearOperationId:D.UUID,returnOperationId:D.UUID,
  createdBy:D.UUID,updatedBy:D.UUID,history:{...required(D.JSON),defaultValue:[]},
 },{sequelize,modelName:'Cheque',tableName:'cheques',timestamps:true,underscored:true});
}
module.exports={Cheque,initChequeModel};
