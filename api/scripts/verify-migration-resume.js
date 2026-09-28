const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Sequelize,DataTypes:D}=require('sequelize');
if(process.env.MIGRATION_TEST_HOST!=='migration-test-mysql'||process.env.MIGRATION_TEST_DATABASE!=='migration_test')throw Error('Requires disposable migration-test-mysql / migration_test.');
const db=new Sequelize('migration_test','root',process.env.MIGRATION_TEST_PASSWORD,{host:'migration-test-mysql',dialect:'mysql',logging:false});
const root=process.env.MIGRATION_TEST_COMPILED==='true'?'../dist/migrations/':'../src/migrations/';
(async()=>{try{
 const q=db.getQueryInterface();if((await q.showAllTables()).length)throw Error('Refusing nonempty test database.');
 for(const table of ['organizations','users'])await q.createTable(table,{id:{type:D.UUID,primaryKey:true}});
 await q.createTable('permissions',{id:{type:D.UUID,primaryKey:true},name:D.STRING,code:{type:D.STRING,unique:true},resource:D.STRING,action:D.STRING,description:D.TEXT,is_system:D.BOOLEAN,is_active:D.BOOLEAN,created_at:D.DATE,updated_at:D.DATE});
 const migrations=['20260928020000-create-bank-ledger','20260928040000-create-organization-roles','20260928050000-create-cheques','20260928060000-create-vouchers'];
 const add=q.addIndex.bind(q);
 for(const name of migrations){
  const migration=require(root+name);let interrupted=false;
  q.addIndex=async(...args)=>{await add(...args);if(!interrupted){interrupted=true;throw Error('Simulated process exit after committed index');}};
  await assert.rejects(migration.up(q,D),/Simulated process exit/);assert(interrupted);q.addIndex=add;
  if(name===migrations[0])await assert.rejects(add('bank_accounts',['organization_id','is_archived'],{name:'bank_accounts_org_status'}),e=>e.original?.code==='ER_DUP_KEYNAME');
  await migration.up(q,D);
  // Repeating a completed but unrecorded migration must not attempt any new DDL indexes.
  q.addIndex=async()=>{throw Error('Unexpected duplicate index creation');};await migration.up(q,D);q.addIndex=add;
 }
 const org=randomUUID(),user=randomUUID(),account=randomUUID(),operation=randomUUID(),now=new Date();
 await q.bulkInsert('organizations',[{id:org}]);await q.bulkInsert('users',[{id:user}]);
 await q.bulkInsert('bank_accounts',[{id:account,organization_id:org,name:'Preserved account',bank_name:'Test',currency:'PHP',balance:'123.45',is_archived:false,created_at:now,updated_at:now}]);
 await q.bulkInsert('bank_operations',[{id:operation,organization_id:org,request_key:randomUUID(),fingerprint:'a'.repeat(64),kind:'opening',created_by:user,created_at:now,updated_at:now}]);
 await q.bulkInsert('bank_entries',[{organization_id:org,account_id:account,operation_id:operation,kind:'opening',direction:'credit',amount:'123.45',balance_after:'123.45',posted_on:'2026-01-01',created_at:now,updated_at:now}]);
 const [permissions]=await db.query('SELECT * FROM permissions ORDER BY code');
 for(const name of migrations)await require(root+name).up(q,D);
 const [accounts]=await db.query('SELECT balance FROM bank_accounts');assert.equal(accounts[0].balance,'123.45');
 const [entries]=await db.query('SELECT amount FROM bank_entries');assert.equal(entries.length,1);assert.equal(entries[0].amount,'123.45');
 const [afterPermissions]=await db.query('SELECT * FROM permissions ORDER BY code');assert.deepEqual(afterPermissions,permissions);assert.equal(permissions.length,3);
 const indexes=await q.showIndex('bank_operations');assert.equal(indexes.find(i=>i.name==='bank_operations_request').unique,true);
 // Keep the fixture foreign key supported while constructing a conflicting index.
 await add('bank_accounts',['organization_id'],{name:'fixture_org_fk'});
 await q.removeIndex('bank_accounts','bank_accounts_org_status');await add('bank_accounts',['name'],{name:'bank_accounts_org_status'});
 await assert.rejects(require(root+migrations[0]).up(q,D),/Schema index conflict/);
 assert.deepEqual((await q.showIndex('bank_accounts')).find(i=>i.name==='bank_accounts_org_status').fields.map(f=>f.attribute),['name']);
 console.log('PASS: reproduced duplicate key, resumed interrupted bank/role/cheque/voucher migrations, completed reruns, preserved balances and ledger entries, permission deduplication, uniqueness and conflicting-index protection ('+root+').');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
