const {DataTypes:D,Model}=require('sequelize');
class Voucher extends Model {}
function initVoucherModel(sequelize){
 const required=type=>({type,allowNull:false});
 Voucher.init({id:{...required(D.UUID),primaryKey:true,defaultValue:D.UUIDV4},organizationId:required(D.UUID),accountId:required(D.UUID),requestKey:required(D.UUID),fingerprint:required(D.STRING(64)),number:required(D.STRING(80)),payee:required(D.STRING(180)),description:required(D.TEXT),category:D.STRING(100),amount:required(D.DECIMAL(14,2)),currency:required(D.STRING(3)),postedOn:required(D.DATEONLY),reference:D.STRING(200),notes:D.TEXT,status:{...required(D.STRING(20)),defaultValue:'posted'},operationId:required(D.UUID),voidOperationId:D.UUID,voidedOn:D.DATEONLY,voidReason:D.TEXT,createdBy:D.UUID,updatedBy:D.UUID,history:{...required(D.JSON),defaultValue:[]}},
 {sequelize,modelName:'Voucher',tableName:'vouchers',timestamps:true,underscored:true});
}
module.exports={Voucher,initVoucherModel};
