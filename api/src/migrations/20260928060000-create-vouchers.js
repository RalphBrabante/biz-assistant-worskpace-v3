const { ensureIndex } = require('../database/resumable-index');
module.exports={async up(q,D){
 const required=type=>({type,allowNull:false});const fk=(table,nullable=false)=>({type:D.UUID,allowNull:nullable,references:{model:table,key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'});
 await q.createTable('vouchers',{id:{...required(D.UUID),primaryKey:true},organization_id:fk('organizations'),account_id:fk('bank_accounts'),request_key:required(D.UUID),fingerprint:required(D.STRING(64)),number:required(D.STRING(80)),payee:required(D.STRING(180)),description:required(D.TEXT),category:D.STRING(100),amount:required(D.DECIMAL(14,2)),currency:required(D.STRING(3)),posted_on:required(D.DATEONLY),reference:D.STRING(200),notes:D.TEXT,status:{...required(D.STRING(20)),defaultValue:'posted'},operation_id:fk('bank_operations'),void_operation_id:fk('bank_operations',true),voided_on:D.DATEONLY,void_reason:D.TEXT,created_by:fk('users',true),updated_by:fk('users',true),history:required(D.JSON),created_at:required(D.DATE),updated_at:required(D.DATE)});
 await ensureIndex(q, 'vouchers',['organization_id','number'],{unique:true,name:'vouchers_number_uq'});
 await ensureIndex(q, 'vouchers',['organization_id','request_key'],{unique:true,name:'vouchers_request_uq'});
 await ensureIndex(q, 'vouchers',['organization_id','status','posted_on'],{name:'vouchers_date_idx'});
},async down(q){await q.dropTable('vouchers');}};
