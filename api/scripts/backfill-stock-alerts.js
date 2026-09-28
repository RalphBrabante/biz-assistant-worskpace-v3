// Seed notifications for products already below their thresholds at rollout.
// Dry run by default; --apply creates only missing first stock notifications.
const {Op}=require('sequelize');
const {authenticateSequelize,getModels}=require('../src/sequelize');
const {stockStatus,notifyStockChange}=require('../src/services/stock-alerts');
(async()=>{
 const db=await authenticateSequelize();let cursor=null,eligible=0,created=0;
 try {
  const {Item,Message}=getModels();
  for(;;){
   const page=await Item.findAll({where:{type:'product',isActive:true,...(cursor?{id:{[Op.gt]:cursor}}:{})},attributes:['id'],order:[['id','ASC']],limit:100});
   if(!page.length)break;
   for(const row of page)await db.transaction(async transaction=>{
    const item=await Item.findByPk(row.id,{transaction,lock:transaction.LOCK.UPDATE});
    if(!item||stockStatus(item)==='normal')return;
    const exists=await Message.findOne({where:{organizationId:item.organizationId,entityId:item.id,'metadata.kind':'stock_alert'},transaction});
    if(exists)return;
    eligible++;
    if(process.argv.includes('--apply')){await notifyStockChange(item,{transaction,stockCreated:true});created++;}
   });
   cursor=page.at(-1).id;
  }
  console.log(JSON.stringify({eligible,created,dryRun:!process.argv.includes('--apply')}));
 }finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
