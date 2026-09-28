const {test}=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const router=require('../src/routes/banks-routes');
const {requireBankAdministrator}=require('../src/middleware/bank-administrator');
test('bank role gate accepts administrators and superusers only',()=>{
  for(const role of ['administrator','superuser','ADMINISTRATOR','SUPERUSER','staff','manager','']){
    let allowed=false;const res={code:200,status(n){this.code=n;return this;},json(){}};
    requireBankAdministrator({auth:{roleCodes:[role],isPrivileged:true,permissions:new Set(['banks.read','banks.manage','banks.transact'])}},res,()=>{allowed=true;});
    assert.equal(allowed,['administrator','superuser'].includes(role.toLowerCase()));if(!allowed)assert.equal(res.code,403);
  }
});
test('every bank endpoint rejects staff even with all bank permissions',async()=>{
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.headers['x-test-staff'])req.auth={roleCodes:['staff'],permissions:new Set(['banks.read','banks.manage','banks.transact']),isPrivileged:false};next();});app.use('/api/v1/banks',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/v1/banks`;
  try{
    for(const [method,path] of [['GET',''],['GET','/account/transactions'],['POST',''],['PUT','/account'],['POST','/transactions'],['POST','/transactions/operation/reverse']]){
      const options={method,headers:{'content-type':'application/json'},...(method==='GET'?{}:{body:'{}'})};
      assert.equal((await fetch(base+path,options)).status,401);
      assert.equal((await fetch(base+path,{...options,headers:{...options.headers,'x-test-staff':'1'}})).status,403);
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
