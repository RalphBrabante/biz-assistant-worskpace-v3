const assert=require('node:assert/strict'),{randomUUID}=require('crypto');
const {Sequelize,DataTypes:D}=require('sequelize');
if(process.env.CHEQUE_TEST_HOST!=='cheque-test-mysql'||process.env.CHEQUE_TEST_DATABASE!=='cheque_test')throw Error('Requires isolated cheque-test-mysql / cheque_test database.');
const s=new Sequelize('cheque_test','root',process.env.CHEQUE_TEST_PASSWORD,{host:'cheque-test-mysql',dialect:'mysql',logging:false,pool:{max:8}});
(async()=>{try{
 const q=s.getQueryInterface();if((await q.showAllTables()).length)throw Error('Refusing nonempty database.');
 const Organization=s.define('Organization',{id:{type:D.UUID,primaryKey:true},currency:D.STRING(3)},{tableName:'organizations',timestamps:false});
 const User=s.define('User',{id:{type:D.UUID,primaryKey:true},firstName:D.STRING,lastName:D.STRING},{tableName:'users',timestamps:false,underscored:true});
 await Organization.sync();await User.sync();await q.createTable('permissions',{id:{type:D.UUID,primaryKey:true},name:D.STRING,code:D.STRING,resource:D.STRING,action:D.STRING,description:D.TEXT,is_system:D.BOOLEAN,is_active:D.BOOLEAN,created_at:D.DATE,updated_at:D.DATE});
 await require('../src/migrations/20260928020000-create-bank-ledger').up(q,D);
 await require('../src/migrations/20260928050000-create-cheques').up(q,D);
 const {BankAccount,BankOperation,BankEntry,initBankModels}=require('../src/models/bank');initBankModels(s);
 const {Cheque,initChequeModel}=require('../src/models/cheque');initChequeModel(s);Cheque.belongsTo(BankAccount,{as:'account',foreignKey:'accountId'});
 const models={Organization,User,BankAccount,BankOperation,BankEntry,Cheque};require('../src/sequelize').getModels=()=>models;
 const c=require('../src/controllers/cheques-controller'),bank=require('../src/controllers/banks-controller');
 const org=randomUUID(),foreign=randomUUID(),userId=randomUUID();await Organization.bulkCreate([{id:org,currency:'PHP'},{id:foreign,currency:'PHP'}]);await User.create({id:userId,firstName:'Cheque',lastName:'Tester'});
 const a=await BankAccount.create({organizationId:org,name:'Operating',bankName:'Test',currency:'PHP',balance:'100.00'}),b=await BankAccount.create({organizationId:foreign,name:'Other',bankName:'Other',currency:'PHP',balance:'100.00'});
 async function call(method,body={},id,organizationId=org,query={}){const res={statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await c[method]({body,params:{id},query,auth:{userId,roleCodes:['administrator'],user:{organizationId}}},res);return res;}
 const payload=(number,extra={})=>({accountId:a.id,number,payee:'Supplier',amount:'25.10',issuedOn:'2026-01-01',datedOn:'2026-01-02',reference:'Bill 123',requestKey:randomUUID(),...extra});
 const issue=payload('001'),created=await call('create',issue);assert.equal(created.statusCode,201,JSON.stringify(created.body));const id=created.body.data.id;
 assert.equal((await a.reload()).balance,'100.00');assert.equal(await BankEntry.count(),0);
 assert.equal((await call('create',issue)).statusCode,200);assert.equal((await call('create',{...issue,amount:'30'})).statusCode,409);
 assert.equal((await call('create',payload('001'))).statusCode,409);assert.equal((await call('create',payload('foreign',{accountId:b.id}))).statusCode,404);
 assert.equal((await call('action',{action:'clear',postedOn:'2026-01-02'},id,foreign)).statusCode,404);
 assert.equal((await call('action',{action:'clear',postedOn:'2026-01-01'},id)).statusCode,400);
 const clear={action:'clear',postedOn:'2026-01-02'};const results=await Promise.all([call('action',clear,id),call('action',clear,id)]);assert(results.every(r=>r.statusCode===200));
 assert.equal((await a.reload()).balance,'74.90');assert.equal(await BankEntry.count(),1);assert.equal(await BankOperation.count(),1);
 assert.equal((await call('action',{...clear,postedOn:'2026-01-03'},id)).statusCode,409);
 const row=await Cheque.findByPk(id);const response={statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};
 await bank.reverse({body:{reason:'Bypass',requestKey:randomUUID()},params:{id:row.clearOperationId},query:{},auth:{userId,roleCodes:['administrator'],user:{organizationId:org}}},response);assert.equal(response.statusCode,409);
 assert.equal((await call('action',{action:'void',reason:'No'},id)).statusCode,409);
 const returned={action:'return',postedOn:'2026-01-03',reason:'Bank returned payment'};
 assert.equal((await call('action',returned,id)).statusCode,200);assert.equal((await call('action',returned,id)).statusCode,200);
 assert.equal((await a.reload()).balance,'100.00');assert.equal(await BankEntry.count(),2);assert.equal((await call('action',clear,id)).statusCode,409);
 const pending=(await call('create',payload('002',{amount:'100.01'}))).body.data;
 assert.equal((await call('action',clear,pending.id)).statusCode,409);assert.equal((await Cheque.findByPk(pending.id)).status,'issued');assert.equal(await BankEntry.count(),2);
 assert.equal((await call('action',{action:'void',reason:'Incorrect amount'},pending.id)).statusCode,200);assert.equal((await a.reload()).balance,'100.00');
 const future=(await call('create',payload('future',{datedOn:'2999-01-01'}))).body.data;assert.equal((await call('action',{action:'clear',postedOn:bank.today()},future.id)).statusCode,400);
 for(const extra of [{amount:'-1'},{amount:'1.001'},{datedOn:'2026-02-30'},{issuedOn:'2999-01-01'}])assert.equal((await call('create',payload(randomUUID(),extra))).statusCode,400);
 const first=(await call('create',payload('compete1',{amount:'75'}))).body.data,second=(await call('create',payload('compete2',{amount:'75'}))).body.data;
 const competing=await Promise.all([call('action',clear,first.id),call('action',clear,second.id)]);assert.deepEqual(competing.map(r=>r.statusCode).sort(),[200,409]);assert.equal((await a.reload()).balance,'25.00');

 const rollbackCheque=(await call('create',payload('rollback',{amount:'1.25'}))).body.data;
 const originalEntry=BankEntry.create;try{BankEntry.create=async()=>{throw Error('Simulated storage failure');};assert.equal((await call('action',clear,rollbackCheque.id)).statusCode,500);}finally{BankEntry.create=originalEntry;}
 assert.equal((await a.reload()).balance,'25.00');assert.equal((await Cheque.findByPk(rollbackCheque.id)).status,'issued');
 await a.update({isArchived:true});assert.equal((await call('action',clear,rollbackCheque.id)).statusCode,409);assert.equal((await call('create',payload('archived'))).statusCode,409);await a.update({isArchived:false});
 const zero=await BankAccount.create({organizationId:org,name:'Empty',bankName:'Test',currency:'PHP',balance:'0.00'});await call('create',payload('outstanding',{accountId:zero.id}));
 const archiveResponse={statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};
 await bank.update({body:{name:zero.name,bankName:zero.bankName,isArchived:true},params:{id:zero.id},query:{},auth:{userId,roleCodes:['administrator'],user:{organizationId:org}}},archiveResponse);assert.equal(archiveResponse.statusCode,409);assert.equal((await zero.reload()).isArchived,false);
 const listed=await call('list',{},null,org,{due:'true'});assert.equal(listed.statusCode,200);assert(listed.body.data.cheques.every(c=>c.organizationId===org&&c.status==='issued'&&c.datedOn<=bank.today()));
 const app=require('express')();app.use(require('express').json());app.use((req,res,next)=>{req.auth={roleCodes:['staff'],permissions:new Set(['banks.read','banks.transact']),user:{organizationId:org}};next();});app.use('/',require('../src/routes/cheques-routes'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{for(const [path,method] of [['/','GET'],['/','POST'],['/'+id+'/actions','POST']])assert.equal((await fetch('http://127.0.0.1:'+server.address().port+path,{method})).status,403);}finally{await new Promise(r=>server.close(r));}
 console.log('PASS: issue without deduction, idempotent issuance and clearance, decimal debit, bank return credit, void, insufficient funds rollback, concurrent clearances, duplicate cheque numbers, dates, organization isolation, generic reversal protection and administrator-only routes.');
}finally{await s.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
