const {Op} = require('sequelize');
const {createHash} = require('crypto');
const {getModels} = require('../sequelize');
const {isPrivilegedRequest} = require('../services/request-scope');
const {fail,cents,money,positive} = require('../services/debt-amounts');
const MAX = 99999999999999n;
function scope(req) {
  const id = isPrivilegedRequest(req) ? req.query.organizationId : req.auth?.user?.organizationId;
  if (typeof id !== 'string' || !id.trim() || id.length > 36) throw fail(400,'Select an organization to manage bank accounts.');
  return {organizationId:id};
}
function text(value,label,max,required=false) {
  if (value == null) value='';
  if (typeof value !== 'string' || value.length>max || (required&&!value.trim())) throw fail(400,`Enter a valid ${label} (up to ${max} characters).`);
  return value.trim();
}
function today() {return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
function date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1000-01-01'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>today()) throw fail(400,'Enter a valid transaction date, no later than today.');
  return value;
}
function uuid(value) {if(typeof value!=='string'||!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) throw fail(400,'A valid request key is required.');return value;}
function endpoint(handler) {return async(req,res)=>{res.set('Cache-Control','private, no-store');try{await handler(req,res);}catch(e){if(!e.status)console.error('[banks]',e.name);res.status(e.status||500).json({message:e.status?e.message:'Unable to complete this bank action. Please retry.'});}};}
async function account(models,id,organizationId,transaction) {
  const row=await models.BankAccount.findOne({where:{id,organizationId},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});
  if(!row)throw fail(404,'Bank account not found.');return row;
}
async function changeBalance(models,row,delta,entry,transaction) {
  if(row.isArchived)throw fail(409,'Restore this account before recording transactions.');
  const balance=cents(row.balance)+delta;
  if(balance<0n)throw fail(409,`Insufficient funds in ${row.name}.`);
  if(balance>MAX)throw fail(400,'The resulting balance exceeds the supported amount.');
  await row.update({balance:money(balance)},{transaction});
  return models.BankEntry.create({...entry,organizationId:row.organizationId,accountId:row.id,direction:delta<0n?'debit':'credit',amount:money(delta<0n?-delta:delta),balanceAfter:money(balance)},{transaction});
}
async function write(req,payload,kind,handler) {
  const models=getModels(), {organizationId}=scope(req), requestKey=uuid(req.body?.requestKey);
  const fingerprint=createHash('sha256').update(JSON.stringify({kind,...payload})).digest('hex');
  return models.BankAccount.sequelize.transaction(async transaction=>{
    // Serialize organization ledger writes, including both sides of transfers and retries.
    const org=await models.Organization.findByPk(organizationId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!org)throw fail(404,'Organization not found.');
    const existing=await models.BankOperation.findOne({where:{organizationId,requestKey},transaction});
    if(existing){if(existing.fingerprint!==fingerprint)throw fail(409,'This request was already used for another action. Reopen the form.');return {operationId:existing.id,repeated:true};}
    const operation=await models.BankOperation.create({organizationId,requestKey,fingerprint,kind,createdBy:req.auth.userId},{transaction});
    await handler({models,organizationId,org,operation,transaction});
    return {operationId:operation.id,repeated:false};
  });
}
const list=endpoint(async(req,res)=>{
  const m=getModels(), where=scope(req);
  const org=await m.Organization.findByPk(where.organizationId,{attributes:['id','currency']});if(!org)throw fail(404,'Organization not found.');
  const accounts=await m.BankAccount.findAll({where,order:[['isArchived','ASC'],['name','ASC'],['id','ASC']]});
  const totals={};for(const row of accounts){if(!row.isArchived)totals[row.currency]=(totals[row.currency]||0n)+cents(row.balance);}
  res.json({data:{accounts,currency:org.currency||'PHP',totals:Object.entries(totals).map(([currency,balance])=>({currency,balance:money(balance)}))}});
});
const create=endpoint(async(req,res)=>{
  const b=req.body||{}, values={name:text(b.name,'account name',120,true),bankName:text(b.bankName,'bank name',120,true),lastFour:text(b.lastFour,'last four digits',4),notes:text(b.notes,'notes',2000),openingBalance:money(cents(b.openingBalance,'opening balance')),postedOn:date(b.postedOn)};
  if(values.lastFour&&!/^\d{4}$/.test(values.lastFour))throw fail(400,'Enter exactly four account digits or leave blank.');
  const result=await write(req,values,'opening',async({models,org,organizationId,operation,transaction})=>{
    const currency=String(org.currency||'PHP').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw fail(400,'Set a valid organization currency first.');
    const row=await models.BankAccount.create({organizationId,name:values.name,bankName:values.bankName,lastFour:values.lastFour,notes:values.notes,currency,balance:'0.00'},{transaction});
    await changeBalance(models,row,cents(values.openingBalance),{operationId:operation.id,kind:'opening',postedOn:values.postedOn,reference:'Opening balance',notes:''},transaction);
  });res.status(result.repeated?200:201).json({data:result,message:'Bank account added.'});
});
const update=endpoint(async(req,res)=>{
  const m=getModels(),{organizationId}=scope(req),b=req.body||{};
  const values={name:text(b.name,'account name',120,true),bankName:text(b.bankName,'bank name',120,true),lastFour:text(b.lastFour,'last four digits',4),notes:text(b.notes,'notes',2000)};
  if(values.lastFour&&!/^\d{4}$/.test(values.lastFour))throw fail(400,'Enter exactly four account digits or leave blank.');
  if(typeof b.isArchived!=='boolean')throw fail(400,'Invalid account status.');
  await m.BankAccount.sequelize.transaction(async transaction=>{
    await m.Organization.findByPk(organizationId,{transaction,lock:transaction.LOCK.UPDATE});
    const row=await account(m,req.params.id,organizationId,transaction);
    if(b.isArchived&&cents(row.balance)!==0n)throw fail(409,'An account must have a zero balance before it can be archived.');
    if(b.isArchived && m.Cheque && await m.Cheque.count({where:{organizationId,accountId:row.id,status:'issued'},transaction}))throw fail(409,'Clear or void outstanding cheques before archiving this account.');
    await row.update({...values,isArchived:b.isArchived},{transaction});
  });res.json({message:'Bank account updated.'});
});
const transact=endpoint(async(req,res)=>{
  const b=req.body||{},kind=b.kind;
  if(!['deposit','withdrawal','transfer'].includes(kind))throw fail(400,'Choose deposit, withdrawal or transfer.');
  const values={accountId:text(b.accountId,'account',36,true),toAccountId:kind==='transfer'?text(b.toAccountId,'destination account',36,true):'',amount:positive(b.amount,'Amount'),postedOn:date(b.postedOn),reference:text(b.reference,'reference',200),notes:text(b.notes,'notes',2000)};
  if(values.accountId===values.toAccountId)throw fail(400,'Select two different accounts for a transfer.');
  const result=await write(req,values,kind,async({models,organizationId,operation,transaction})=>{
    const from=await account(models,values.accountId,organizationId,transaction);
    const to=kind==='transfer'?await account(models,values.toAccountId,organizationId,transaction):null;
    if(to&&to.currency!==from.currency)throw fail(400,'Transfers require matching account currencies.');
    const entry={operationId:operation.id,kind,postedOn:values.postedOn,reference:values.reference,notes:values.notes};
    await changeBalance(models,from,cents(values.amount)*(kind==='deposit'?1n:-1n),entry,transaction);
    if(to)await changeBalance(models,to,cents(values.amount),entry,transaction);
  });res.status(result.repeated?200:201).json({data:result,message:'Transaction recorded.'});
});
const reverse=endpoint(async(req,res)=>{
  const values={operationId:text(req.params.id,'transaction',36,true),reason:text(req.body?.reason,'reversal reason',2000,true)};
  const result=await write(req,values,'reversal',async({models,organizationId,operation,transaction})=>{
    const original=await models.BankOperation.findOne({where:{id:values.operationId,organizationId},transaction});
    if(!original)throw fail(404,'Transaction not found.');
    if(['voucher','voucher_void'].includes(original.kind))throw fail(409,'Void vouchers from the Vouchers page to keep the voucher and ledger consistent.');
    if(['cheque','cheque_return'].includes(original.kind))throw fail(409,'Manage cheque returns from Cheque management to keep the cheque and bank ledger consistent.');
    if(['opening','reversal'].includes(original.kind))throw fail(409,'Opening balances and reversals cannot be reversed. Record a correcting deposit or withdrawal.');
    if(await models.BankOperation.findOne({where:{reversalOf:original.id,organizationId},transaction}))throw fail(409,'This transaction has already been reversed.');
    const entries=await models.BankEntry.findAll({where:{operationId:original.id,organizationId},order:[['accountId','ASC']],transaction});
    if(!entries.length)throw fail(409,'This transaction has no ledger entries.');
    await operation.update({reversalOf:original.id},{transaction});
    for(const entry of entries){const row=await account(models,entry.accountId,organizationId,transaction);await changeBalance(models,row,cents(entry.amount)*(entry.direction==='credit'?-1n:1n),{operationId:operation.id,kind:'reversal',postedOn:today(),reference:`Reversal ${original.id}`,notes:values.reason},transaction);}
  });res.json({data:result,message:'Transaction reversed. Original history retained.'});
});
const history=endpoint(async(req,res)=>{
  const m=getModels(),{organizationId}=scope(req),row=await account(m,req.params.id,organizationId),page=Number(req.query.page||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid page.');
  const where={organizationId,accountId:row.id};
  if(req.query.kind){if(!['opening','deposit','withdrawal','transfer','reversal','cheque','cheque_return','voucher','voucher_void'].includes(req.query.kind))throw fail(400,'Invalid transaction type.');where.kind=req.query.kind;}
  if(req.query.from||req.query.to){where.postedOn={};if(req.query.from)where.postedOn[Op.gte]=date(req.query.from);if(req.query.to)where.postedOn[Op.lte]=date(req.query.to);if(req.query.from&&req.query.to&&req.query.from>req.query.to)throw fail(400,'Start date must be before end date.');}
  const {rows,count}=await m.BankEntry.findAndCountAll({where,include:[{association:'operation',include:[{association:'author',attributes:['firstName','lastName']},{association:'reversal',attributes:['id']}]}],order:[['id','DESC']],limit:25,offset:(page-1)*25});
  res.json({data:{account:row,entries:rows},meta:{page,total:count,totalPages:Math.ceil(count/25)}});
});
module.exports={scope,list,create,update,transact,reverse,history,changeBalance,today};
