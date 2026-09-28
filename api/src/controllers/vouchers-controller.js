const {Op}=require('sequelize');
const {randomUUID,createHash}=require('crypto');
const {getModels}=require('../sequelize');
const {scope,changeBalance,today}=require('./banks-controller');
const {fail,cents,positive}=require('../services/debt-amounts');
function text(value,label,max,required=false){if(value==null)value='';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail(400,`Enter a valid ${label}.`);return value.trim();}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1000-01-01'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>today())throw fail(400,'Enter a valid date, no later than today.');return value;}
function endpoint(fn){return async(req,res)=>{res.set('Cache-Control','private, no-store');try{await fn(req,res);}catch(e){if(!e.status&&e.name!=='SequelizeUniqueConstraintError')console.error('[vouchers]',e.name);res.status(e.status||(e.name==='SequelizeUniqueConstraintError'?409:500)).json({message:e.status?e.message:e.name==='SequelizeUniqueConstraintError'?'This voucher number already exists in your organization.':'Unable to save the voucher. Please retry.'});}};}
async function write(req,fn){const m=getModels(),{organizationId}=scope(req);return m.Voucher.sequelize.transaction(async transaction=>{if(!await m.Organization.findByPk(organizationId,{transaction,lock:transaction.LOCK.UPDATE}))throw fail(404,'Organization not found.');return fn(m,organizationId,transaction);});}
async function account(m,id,organizationId,transaction){const row=await m.BankAccount.findOne({where:{id,organizationId},transaction,lock:transaction.LOCK.UPDATE});if(!row)throw fail(404,'Bank account not found.');return row;}
const list=endpoint(async(req,res)=>{
 const m=getModels(),where=scope(req),page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid page.');
 if(req.query.status){if(!['posted','void'].includes(req.query.status))throw fail(400,'Invalid status.');where.status=req.query.status;}
 if(req.query.accountId)where.accountId=text(req.query.accountId,'bank account',36,true);
 if(req.query.q){const q=text(req.query.q,'search',180);where[Op.or]=['number','payee','reference','description'].map(key=>({[key]:{[Op.like]:`%${q}%`}}));}
 if(req.query.from||req.query.to){where.postedOn={};if(req.query.from)where.postedOn[Op.gte]=date(req.query.from);if(req.query.to)where.postedOn[Op.lte]=date(req.query.to);if(req.query.from&&req.query.to&&req.query.from>req.query.to)throw fail(400,'Start date must be before end date.');}
 const {rows,count}=await m.Voucher.findAndCountAll({where,include:[{association:'account',attributes:['id','name','bankName','lastFour','isArchived']}],order:[['postedOn','DESC'],['createdAt','DESC'],['id','ASC']],limit:25,offset:(page-1)*25});
 res.json({data:rows,meta:{page,total:count,totalPages:Math.ceil(count/25)}});
});
const create=endpoint(async(req,res)=>{
 const b=req.body||{},requestKey=text(b.requestKey,'request key',36,true);if(!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(requestKey))throw fail(400,'A valid request key is required.');
 const payload={accountId:text(b.accountId,'bank account',36,true),number:text(b.number,'voucher number',80,true),payee:text(b.payee,'payee',180,true),description:text(b.description,'payment details',2000,true),category:text(b.category,'category',100),amount:positive(b.amount,'Amount'),postedOn:date(b.postedOn),reference:text(b.reference,'reference',200),notes:text(b.notes,'notes',2000)};
 const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');let repeated=false;
 const voucher=await write(req,async(m,organizationId,transaction)=>{
  const existing=await m.Voucher.findOne({where:{organizationId,requestKey},transaction});if(existing){if(existing.fingerprint!==fingerprint)throw fail(409,'This request was used for different details. Reopen the form.');repeated=true;return existing;}
  const bank=await account(m,payload.accountId,organizationId,transaction);
  const operation=await m.BankOperation.create({organizationId,requestKey:randomUUID(),fingerprint,kind:'voucher',createdBy:req.auth.userId},{transaction});
  await changeBalance(m,bank,-cents(payload.amount),{operationId:operation.id,kind:'voucher',postedOn:payload.postedOn,reference:`Voucher ${payload.number}`,notes:`${payload.payee} — ${payload.description}`},transaction);
  return m.Voucher.create({...payload,organizationId,currency:bank.currency,requestKey,fingerprint,operationId:operation.id,createdBy:req.auth.userId,updatedBy:req.auth.userId,history:[{action:'posted',at:new Date().toISOString(),userId:req.auth.userId}]},{transaction});
 });res.status(repeated?200:201).json({data:voucher,message:repeated?'Voucher already recorded. No additional deduction was made.':'Voucher created and bank balance deducted.'});
});
const voidVoucher=endpoint(async(req,res)=>{
 const reason=text(req.body?.reason,'void reason',2000,true),postedOn=date(req.body?.postedOn);
 const voucher=await write(req,async(m,organizationId,transaction)=>{
  const row=await m.Voucher.findOne({where:{id:req.params.id,organizationId},transaction,lock:transaction.LOCK.UPDATE});if(!row)throw fail(404,'Voucher not found.');
  if(row.status==='void'){if(row.voidReason!==reason||row.voidedOn!==postedOn)throw fail(409,'This voucher was already voided with different details.');return row;}
  if(postedOn<row.postedOn)throw fail(400,'Void date cannot be before the voucher date.');
  const bank=await account(m,row.accountId,organizationId,transaction);
  const operation=await m.BankOperation.create({organizationId,requestKey:randomUUID(),fingerprint:createHash('sha256').update(row.id+':void').digest('hex'),kind:'voucher_void',reversalOf:row.operationId,createdBy:req.auth.userId},{transaction});
  await changeBalance(m,bank,cents(row.amount),{operationId:operation.id,kind:'voucher_void',postedOn,reference:`Void voucher ${row.number}`,notes:reason},transaction);
  const history=typeof row.history==='string'?JSON.parse(row.history):row.history;
  await row.update({status:'void',voidOperationId:operation.id,voidedOn:postedOn,voidReason:reason,updatedBy:req.auth.userId,history:[...(history||[]),{action:'void',at:new Date().toISOString(),postedOn,reason,userId:req.auth.userId}]},{transaction});return row;
 });res.json({data:voucher,message:'Voucher voided and linked bank balance restored.'});
});
module.exports={list,create,voidVoucher};
