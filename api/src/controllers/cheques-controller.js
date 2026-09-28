const {Op}=require('sequelize');
const {randomUUID,createHash}=require('crypto');
const {getModels}=require('../sequelize');
const {scope,changeBalance,today}=require('./banks-controller');
const {fail,cents,positive,money}=require('../services/debt-amounts');
function text(value,label,max,required=false){if(value==null)value='';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw fail(400,`Enter a valid ${label}.`);return value.trim();}
function date(value,label,allowFuture=false){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1000-01-01'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||(!allowFuture&&value>today()))throw fail(400,`Enter a valid ${label}${allowFuture?'':', no later than today'}.`);return value;}
function endpoint(handler){return async(req,res)=>{res.set('Cache-Control','private, no-store');try{await handler(req,res);}catch(e){if(!e.status&&e.name!=='SequelizeUniqueConstraintError')console.error('[cheques]',e.name);res.status(e.status||(e.name==='SequelizeUniqueConstraintError'?409:500)).json({message:e.status?e.message:e.name==='SequelizeUniqueConstraintError'?'This cheque number is already recorded for that bank account.':'Unable to complete this cheque action.'});}};}
async function write(req,handler){const m=getModels(),{organizationId}=scope(req);return m.Cheque.sequelize.transaction(async transaction=>{
 const org=await m.Organization.findByPk(organizationId,{transaction,lock:transaction.LOCK.UPDATE});if(!org)throw fail(404,'Organization not found.');
 return handler(m,organizationId,transaction);
});}
function history(row,event){let previous=row.history||[];if(typeof previous==='string')previous=JSON.parse(previous);return [...previous,event];}
function event(req,action,extra={}){return {action,userId:req.auth.userId,at:new Date().toISOString(),...extra};}
const list=endpoint(async(req,res)=>{
 const m=getModels(),{organizationId}=scope(req),where={organizationId},page=Number(req.query.page||1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid page.');
 if(req.query.status){if(!['issued','cleared','void','returned'].includes(req.query.status))throw fail(400,'Invalid cheque status.');where.status=req.query.status;}
 if(req.query.accountId)where.accountId=text(req.query.accountId,'bank account',36,true);
 if(req.query.q){const q=text(req.query.q,'search',180);where[Op.or]=['number','payee','reference'].map(key=>({[key]:{[Op.like]:`%${q}%`}}));}
 if(req.query.due==='true'){where.status='issued';where.datedOn={[Op.lte]:today()};}
 const {rows,count}=await m.Cheque.findAndCountAll({where,include:[{association:'account',attributes:['id','name','bankName','lastFour','isArchived']}],order:[['datedOn','ASC'],['id','ASC']],limit:25,offset:(page-1)*25});
 const pending=await m.Cheque.findAll({where:{organizationId,status:'issued'},attributes:['amount','currency','datedOn']});
 const totals={};for(const row of pending){totals[row.currency]??={currency:row.currency,outstanding:0n,due:0n};totals[row.currency].outstanding+=cents(row.amount);if(row.datedOn<=today())totals[row.currency].due+=cents(row.amount);}
 res.json({data:{cheques:rows,totals:Object.values(totals).map(t=>({...t,outstanding:money(t.outstanding),due:money(t.due)}))},meta:{page,total:count,totalPages:Math.ceil(count/25)}});
});
const create=endpoint(async(req,res)=>{
 const b=req.body||{},requestKey=text(b.requestKey,'request key',36,true);
 if(!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(requestKey))throw fail(400,'A valid request key is required.');
 const payload={accountId:text(b.accountId,'bank account',36,true),number:text(b.number,'cheque number',80,true),payee:text(b.payee,'payee',180,true),amount:positive(b.amount,'Amount'),issuedOn:date(b.issuedOn,'issue date'),datedOn:date(b.datedOn,'cheque date',true),reference:text(b.reference,'payment reference',200),notes:text(b.notes,'notes',2000)};
 if(payload.datedOn<payload.issuedOn)throw fail(400,'Cheque date cannot be before the issue date.');
 const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');let repeated=false;
 const row=await write(req,async(m,organizationId,transaction)=>{
  const prior=await m.Cheque.findOne({where:{organizationId,requestKey},transaction});if(prior){if(prior.fingerprint!==fingerprint)throw fail(409,'This request was used for different cheque details. Reopen the form.');repeated=true;return prior;}
  const account=await m.BankAccount.findOne({where:{id:payload.accountId,organizationId},transaction,lock:transaction.LOCK.UPDATE});
  if(!account)throw fail(404,'Bank account not found.');if(account.isArchived)throw fail(409,'Restore the bank account before issuing a cheque.');
  return m.Cheque.create({...payload,organizationId,currency:account.currency,requestKey,fingerprint,createdBy:req.auth.userId,updatedBy:req.auth.userId,history:[event(req,'issued')]},{transaction});
 });res.status(repeated?200:201).json({data:row,message:'Cheque recorded. The bank balance changes only when cleared.'});
});
const action=endpoint(async(req,res)=>{
 const b=req.body||{},action=b.action;if(!['clear','void','return'].includes(action))throw fail(400,'Choose a valid cheque action.');
 const reason=text(b.reason,'reason',2000,action!=='clear'),postedOn=action==='void'?today():date(b.postedOn,action==='clear'?'clearance date':'return date');
 const row=await write(req,async(m,organizationId,transaction)=>{
  const cheque=await m.Cheque.findOne({where:{id:req.params.id,organizationId},transaction,lock:transaction.LOCK.UPDATE});if(!cheque)throw fail(404,'Cheque not found.');
  const target={clear:'cleared',void:'void',return:'returned'}[action];
  if(cheque.status===target){const prior=history(cheque,null).slice(0,-1).at(-1);if(action==='clear'?cheque.clearedOn!==postedOn:prior?.reason!==reason||(action==='return'&&cheque.returnedOn!==postedOn))throw fail(409,'This cheque action was already recorded with different details.');return cheque;}
  if(cheque.status!==(action==='return'?'cleared':'issued'))throw fail(409,'This action is not available for the cheque’s current status.');
  if(action==='clear'&&postedOn<cheque.datedOn)throw fail(400,'A post-dated cheque cannot clear before its cheque date.');
  if(action==='return'&&postedOn<cheque.clearedOn)throw fail(400,'Return date cannot be before clearance.');
  const changes={status:target,updatedBy:req.auth.userId,history:history(cheque,event(req,target,{postedOn,reason}))};
  if(action!=='void'){
   const account=await m.BankAccount.findOne({where:{id:cheque.accountId,organizationId},transaction,lock:transaction.LOCK.UPDATE});if(!account)throw fail(404,'Bank account not found.');
   const operation=await m.BankOperation.create({organizationId,requestKey:randomUUID(),fingerprint:createHash('sha256').update(`${cheque.id}:${action}`).digest('hex'),kind:action==='clear'?'cheque':'cheque_return',reversalOf:action==='return'?cheque.clearOperationId:null,createdBy:req.auth.userId},{transaction});
   await changeBalance(m,account,cents(cheque.amount)*(action==='clear'?-1n:1n),{operationId:operation.id,kind:operation.kind,postedOn,reference:`Cheque ${cheque.number}`,notes:`${cheque.payee}${reason?' — '+reason:''}`},transaction);
   if(action==='clear'){changes.clearedOn=postedOn;changes.clearOperationId=operation.id;}else{changes.returnedOn=postedOn;changes.returnOperationId=operation.id;}
  }
  await cheque.update(changes,{transaction});return cheque;
 });res.json({data:row,message:action==='clear'?'Cheque cleared and bank balance deducted.':action==='return'?'Cheque returned and bank balance restored.':'Cheque voided. Bank balance unchanged.'});
});
module.exports={list,create,action};
