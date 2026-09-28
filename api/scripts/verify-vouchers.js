const assert=require('node:assert/strict'),{randomUUID}=require('crypto');
const {Sequelize,DataTypes:D}=require('sequelize');
if(process.env.VOUCHER_TEST_HOST!=='voucher-test-mysql'||process.env.VOUCHER_TEST_DATABASE!=='voucher_test')throw Error('Requires isolated voucher-test-mysql / voucher_test database.');
const s=new Sequelize('voucher_test','root',process.env.VOUCHER_TEST_PASSWORD,{host:'voucher-test-mysql',dialect:'mysql',logging:false,pool:{max:8}});
(async()=>{try{
 const q=s.getQueryInterface();if((await q.showAllTables()).length)throw Error('Refusing nonempty database.');
 const Organization=s.define('Organization',{id:{type:D.UUID,primaryKey:true},currency:D.STRING(3)},{tableName:'organizations',timestamps:false});
 const User=s.define('User',{id:{type:D.UUID,primaryKey:true},firstName:D.STRING,lastName:D.STRING},{tableName:'users',timestamps:false,underscored:true});
 await Organization.sync();await User.sync();await q.createTable('permissions',{id:{type:D.UUID,primaryKey:true},name:D.STRING,code:D.STRING,resource:D.STRING,action:D.STRING,description:D.TEXT,is_system:D.BOOLEAN,is_active:D.BOOLEAN,created_at:D.DATE,updated_at:D.DATE});
 await require('../src/migrations/20260928020000-create-bank-ledger').up(q,D);
 await require('../src/migrations/20260928060000-create-vouchers').up(q,D);
 const {BankAccount,BankOperation,BankEntry,initBankModels}=require('../src/models/bank');initBankModels(s);
 const {Voucher,initVoucherModel}=require('../src/models/voucher');initVoucherModel(s);Voucher.belongsTo(BankAccount,{as:'account',foreignKey:'accountId'});
 const models={Organization,User,BankAccount,BankOperation,BankEntry,Voucher};require('../src/sequelize').getModels=()=>models;
 const c=require('../src/controllers/vouchers-controller'),bank=require('../src/controllers/banks-controller');
 const org=randomUUID(),foreign=randomUUID(),userId=randomUUID();await Organization.bulkCreate([{id:org,currency:'PHP'},{id:foreign,currency:'PHP'}]);await User.create({id:userId,firstName:'Voucher',lastName:'Tester'});
 const a=await BankAccount.create({organizationId:org,name:'Operating',bankName:'Test',currency:'PHP',balance:'100.00'}),b=await BankAccount.create({organizationId:foreign,name:'Foreign',bankName:'Other',currency:'PHP',balance:'100.00'});
 async function call(method,body={},id,organizationId=org,query={}){const res={statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};await c[method]({body,params:{id},query,auth:{userId,roleCodes:['administrator'],user:{organizationId}}},res);return res;}
 const payload=(number,extra={})=>({accountId:a.id,number,payee:'Supplier',description:'Office supplies',category:'Operations',amount:'25.10',postedOn:'2026-01-02',reference:'Bill 123',requestKey:randomUUID(),...extra});
 const p=payload('001'),results=await Promise.all([call('create',p),call('create',p)]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,201]);
 const voucher=results[0].body.data;assert.equal((await a.reload()).balance,'74.90');assert.equal(await BankEntry.count(),1);assert.equal(await Voucher.count(),1);
 assert.equal((await call('create',{...p,amount:'30.00'})).statusCode,409);
 assert.equal((await call('create',payload('001'))).statusCode,409);assert.equal((await a.reload()).balance,'74.90');assert.equal(await BankOperation.count(),1);
 assert.equal((await call('create',payload('foreign',{accountId:b.id}))).statusCode,404);
 assert.equal((await call('create',payload('insufficient',{amount:'100'}))).statusCode,409);assert.equal(await Voucher.count(),1);
 for(const extra of [{amount:'0'},{amount:'-1'},{amount:'1.001'},{postedOn:'2999-01-01'},{postedOn:'2026-02-30'},{description:''}])assert.equal((await call('create',payload(randomUUID(),extra))).statusCode,400);
 const reverseRes={statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};
 await bank.reverse({body:{reason:'Bypass',requestKey:randomUUID()},params:{id:voucher.operationId},query:{},auth:{userId,roleCodes:['administrator'],user:{organizationId:org}}},reverseRes);assert.equal(reverseRes.statusCode,409);
 const voidBody={reason:'Duplicate payment',postedOn:'2026-01-03'};
 assert.equal((await call('voidVoucher',voidBody,voucher.id,foreign)).statusCode,404);
 assert.equal((await call('voidVoucher',{...voidBody,postedOn:'2026-01-01'},voucher.id)).statusCode,400);
 const voids=await Promise.all([call('voidVoucher',voidBody,voucher.id),call('voidVoucher',voidBody,voucher.id)]);assert(voids.every(r=>r.statusCode===200));assert.equal((await a.reload()).balance,'100.00');assert.equal(await BankEntry.count(),2);
 assert.equal((await call('create',p)).statusCode,200);assert.equal((await a.reload()).balance,'100.00');
 assert.equal((await call('voidVoucher',{...voidBody,reason:'different'},voucher.id)).statusCode,409);
 const original=Voucher.create;try{Voucher.create=async()=>{throw Error('Storage failure');};assert.equal((await call('create',payload('rollback'))).statusCode,500);}finally{Voucher.create=original;}
 assert.equal((await a.reload()).balance,'100.00');assert.equal(await BankOperation.count(),2);
 await a.update({isArchived:true});assert.equal((await call('create',payload('archived'))).statusCode,409);await a.update({isArchived:false});
 const competing=await Promise.all([call('create',payload('002',{amount:'75.00'})),call('create',payload('003',{amount:'75.00'}))]);assert.deepEqual(competing.map(r=>r.statusCode).sort(),[201,409]);assert.equal((await a.reload()).balance,'25.00');
 const listed=await call('list',{},null,org,{status:'posted',q:'Supplier',from:'2026-01-01',to:'2026-01-31'});assert.equal(listed.statusCode,200);assert.equal(listed.body.meta.total,1);assert.equal(listed.body.data[0].account.id,a.id);
 assert.equal((await call('list',{},null,foreign)).body.meta.total,0);
 const app=require('express')();app.use(require('express').json());app.use((req,res,next)=>{req.auth={roleCodes:['staff'],permissions:new Set(['banks.read','banks.transact']),user:{organizationId:org}};next();});app.use('/',require('../src/routes/vouchers-routes'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{for(const [path,method] of [['/','GET'],['/','POST'],['/'+voucher.id+'/void','POST']])assert.equal((await fetch('http://127.0.0.1:'+server.address().port+path,{method})).status,403);}finally{await new Promise(r=>server.close(r));}
 console.log('PASS: atomic voucher debit, duplicate and concurrent retries, exact cents, insufficient funds, unique voucher numbers, rollback, void credit once, archived banks, dates, scoped listing and administrator-only routes.');
}finally{await s.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
