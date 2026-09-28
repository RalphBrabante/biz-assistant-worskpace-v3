const { ensureIndex } = require('../database/resumable-index');
module.exports={
 async up(q,D){
  const required=type=>({type,allowNull:false});
  const fk=(table,nullable=false)=>({type:D.UUID,allowNull:nullable,references:{model:table,key:'id'},onUpdate:'CASCADE',onDelete:'RESTRICT'});
  await q.createTable('cheques',{
   id:{...required(D.UUID),primaryKey:true},organization_id:fk('organizations'),account_id:fk('bank_accounts'),request_key:required(D.UUID),fingerprint:required(D.STRING(64)),
   number:required(D.STRING(80)),payee:required(D.STRING(180)),amount:required(D.DECIMAL(14,2)),currency:required(D.STRING(3)),issued_on:required(D.DATEONLY),dated_on:required(D.DATEONLY),reference:D.STRING(200),notes:D.TEXT,
   status:{...required(D.STRING(20)),defaultValue:'issued'},cleared_on:D.DATEONLY,returned_on:D.DATEONLY,clear_operation_id:fk('bank_operations',true),return_operation_id:fk('bank_operations',true),
   created_by:fk('users',true),updated_by:fk('users',true),history:required(D.JSON),created_at:required(D.DATE),updated_at:required(D.DATE),
  });
  await ensureIndex(q, 'cheques',['organization_id','account_id','number'],{unique:true,name:'cheques_account_number_uq'});
  await ensureIndex(q, 'cheques',['organization_id','request_key'],{unique:true,name:'cheques_request_uq'});
  await ensureIndex(q, 'cheques',['organization_id','status','dated_on'],{name:'cheques_due_idx'});
 },
 async down(q){await q.dropTable('cheques');}
};
