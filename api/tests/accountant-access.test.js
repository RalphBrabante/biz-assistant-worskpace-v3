const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const {effectiveRoleAccess,resolveTokenOrganizationId}=require('../src/services/role-access');
const {ACCOUNTANT_PERMISSIONS}=require('../src/services/accountant-access');
const {authorize}=require('../src/middleware/authz');
const {assertOrganizationAccess,applyOrganizationWhereScope}=require('../src/services/request-scope');
function load(file,models,overrides={}) {
 const filename=require.resolve(file),real=createRequire(filename),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,process,Date,require(name){return name==='../sequelize'?{getModels:()=>models}:overrides[name]||real(name);}});
 return module.exports;
}
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
function fixture(){
 const user={id:'person',organizationId:'a',isActive:true,status:'active',isEmailVerified:true,email:'accountant@example.test',firstName:'A',lastName:'Person',password:'test',roles:[],async update(p){Object.assign(this,p);},toJSON(){return {...this};}};
 const memberships=[{id:'a-member',userId:user.id,organizationId:'a',role:'administrator',isActive:true,isPrimary:true},{id:'b-member',userId:user.id,organizationId:'b',role:'accountant',isActive:true,isPrimary:false}];
 const roles=[{role:{code:'administrator',permissions:[{code:'expenses.update'},{code:'banks.read'}]}},{role:{code:'accountant',permissions:[{code:'expenses.delete'},{code:'reports.delete'}]}}];
 const licenses=[],tokens=[],token={id:'token',expiresAt:new Date(Date.now()+60000),metadata:{organizationId:'b'},user};
 const models={Role:{findOne:async({where})=>roles.find(a=>a.role.code===where.code)?.role},Permission:{},User:{findByPk:async()=>user,findOne:async()=>user},UserRole:{findAll:async()=>roles},OrganizationUser:{findOne:async({where})=>memberships.find(m=>(!where.organizationId||m.organizationId===where.organizationId)&&(where.isActive===undefined||m.isActive===where.isActive)&&(where.isPrimary===undefined||m.isPrimary===where.isPrimary)),findAll:async()=>memberships.filter(m=>m.isActive)},OrganizationUserRole:{findAll:async()=>[]},OrganizationRole:{},Token:{findOne:async(options)=>{assert.equal(options.where.type,'access');return token;},create:async(p)=>tokens.push(p)},License:{findOne:async({where})=>{licenses.push(where.organizationId);return {};},findAll:async()=>[{organizationId:'a'},{organizationId:'b'}]},Organization:{findAll:async()=>[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]},InvalidLoginAttempt:{findOne:async()=>null,destroy:async()=>{}}};
 return {models,user,memberships,roles,licenses,tokens,token};
}
test('selected accountant membership caps global write grants and administrator rights from another organization',async()=>{
 const f=fixture(),access=await effectiveRoleAccess(f.models,f.user,'b');
 assert.deepEqual(access.roleCodes,['accountant']);assert.deepEqual([...access.permissions].sort(),[...ACCOUNTANT_PERMISSIONS].sort());
 assert.deepEqual((await effectiveRoleAccess(f.models,f.user,'a')).roleCodes,['administrator']);assert.equal((await effectiveRoleAccess(f.models,f.user,'c')).permissions.size,0);
});
test('legacy global accountant has read-only primary access and no access through ordinary membership elsewhere',async()=>{
 const f=fixture();f.roles.splice(0,1);f.memberships.splice(0,1);
 assert.deepEqual([...(await effectiveRoleAccess(f.models,f.user,'a')).permissions].sort(),[...ACCOUNTANT_PERMISSIONS].sort());
 f.memberships.push({organizationId:'c',role:'member',isActive:true});assert.equal((await effectiveRoleAccess(f.models,f.user,'c')).permissions.size,0);
});
test('session enforces selected license, allowed reads/report generation, and denies all writes and unrelated modules',async()=>{
 const f=fixture(),{authenticateRequest}=load('../src/middleware/authz',f.models),req={method:'GET',path:'/expenses',get:()=> 'Bearer test'},res=response();let proceeded=false;
 await authenticateRequest(req,res,err=>{assert.ifError(err);proceeded=true;});
 assert.equal(proceeded,true);assert.equal(req.auth.isPrivileged,false);assert.equal(req.auth.user.organizationId,'b');assert.deepEqual(f.licenses,['b']);
 for(const code of ACCOUNTANT_PERMISSIONS){let allowed=false;authorize(code)(req,response(),()=>{allowed=true;});assert.equal(allowed,true,code);}
 for(const code of ['expenses.create','expenses.update','expenses.delete','expenses.pay','expenses.approve','sales_invoices.create','sales_invoices.update','sales_invoices.pay','reports.delete','organizations.update','users.read','banks.read','banks.manage','settings.update','items.read','orders.read','debts.read','licenses.read']){let allowed=false;const r=response();authorize(code)(req,r,()=>{allowed=true;});assert.equal(allowed,false,code);assert.equal(r.statusCode,403,code);}
 assert.equal(assertOrganizationAccess(req,'a'),false);assert.equal(assertOrganizationAccess(req,'b'),true);const where={organizationId:'a'};applyOrganizationWhereScope(where,req);assert.equal(where.organizationId,'b');
});
test('login permissions match refreshed session permissions in the selected organization',async()=>{
 const f=fixture(),controller=load('../src/controllers/auth-controller',f.models,{'bcryptjs':{compare:async()=>true}}),res=response();
 await controller.login({body:{email:f.user.email,password:'test',organizationId:'b'},get:()=>'',ip:'127.0.0.1'},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.data.user.organizationId,'b');assert.deepEqual(Array.from(res.body.data.user.roleCodes),['accountant']);assert.deepEqual(Array.from(res.body.data.user.permissionCodes).sort(),[...ACCOUNTANT_PERMISSIONS].sort());assert.equal(f.tokens[0].metadata.organizationId,'b');
});
test('inactive membership invalidates HTTP and socket token scope even when legacy primary organization still matches',async()=>{
 const f=fixture();f.memberships[1].isActive=false;f.user.organizationId='b';await assert.rejects(resolveTokenOrganizationId(f.models,f.user,f.token,'a'),err=>err.status===401);
 const {authenticateRequest}=load('../src/middleware/authz',f.models),res=response();let proceeded=false;
 await authenticateRequest({method:'GET',path:'/expenses',get:()=> 'Bearer test'},res,()=>{proceeded=true;});assert.equal(proceeded,false);assert.equal(res.statusCode,401);
});
test('organization custom roles are effective but cannot grant organization administration or banks',async()=>{
 const f=fixture();f.roles.length=0;f.memberships[1].role='member';f.models.OrganizationUserRole.findAll=async()=>[{role:{code:'auditor',permissions:[{code:'expenses.read'},{code:'organizations.update'},{code:'banks.read'}]}}];
 const access=await effectiveRoleAccess(f.models,f.user,'b');assert.deepEqual(access.roleCodes,['org:auditor']);assert.deepEqual([...access.permissions],['expenses.read']);
});
test('superusers retain platform access and only active allowed global assignments are queried',async()=>{
 const f=fixture();f.roles.push({role:{code:'superuser',permissions:[]}});f.models.UserRole.findAll=async options=>{assert.equal(options.where.isActive,true);assert.equal(options.include[0].where.isActive,true);assert.equal(options.include[0].include[0].through.where.isAllowed,true);assert.equal(options.include[0].include[0].through.where.isActive,true);return f.roles;};assert.ok((await effectiveRoleAccess(f.models,f.user,'b')).roleCodes.includes('superuser'));
});
module.exports={load,response};

function invitationFixture(existingUser=false){
 const sent=[],tokens=[],memberships=[],updates=[],transaction={LOCK:{UPDATE:'UPDATE'}};
 let user=existingUser?{id:'existing',email:'accountant@example.test',firstName:'A',lastName:'Person',organizationId:'a',role:'administrator',status:'active',isActive:true,isEmailVerified:true,async update(p){updates.push(p);Object.assign(this,p);}}:null;
 const models={
  Role:{findByPk:async id=>({id,code:id==='admin-role'?'administrator':id==='accountant-role'?'accountant':id==='super-role'?'superuser':'enduser',isActive:true}),findOne:async({where})=>({code:where.code,isActive:true})},
  Organization:{findByPk:async id=>id==='b'?{id:'b',name:'Beta',isActive:true}:null},
  User:{sequelize:{transaction:async cb=>cb(transaction)},findOne:async()=>user,findByPk:async()=>user,create:async(p,options)=>{assert.equal(options.transaction,transaction);user={...p,id:'new',async update(p){updates.push(p);Object.assign(this,p);}};return user;}},
  OrganizationUser:{findOne:async()=>memberships[0],count:async()=>existingUser?1:0,create:async(p,options)=>{assert.equal(options.transaction,transaction);const row={...p,id:'membership',async update(p){Object.assign(this,p);}};memberships.push(row);return row;}},
  UserRole:{findOrCreate:async()=>assert.fail('Accountant invitation must not assign global roles')},
  Token:{create:async(p,options)=>{assert.equal(options.transaction,transaction);tokens.push(p);},update:async()=>assert.fail('Do not invalidate existing password-reset requests')},
 };
 const controller=load('../src/controllers/organizations-controller',models,{'../services/email-service':{sendOrganizationUserInviteEmail:async payload=>sent.push(payload)}});
 const req={auth:{roleCodes:['administrator'],userId:'admin',user:{organizationId:'b'}},params:{id:'b'},body:{email:' ACCOUNTANT@example.test ',firstName:'A',lastName:'Person'},get:()=>'',ip:'127.0.0.1'};
 return {controller,req,sent,tokens,memberships,updates,models,get user(){return user;}};
}
test('email invitation creates an unverified account and an organization-only accountant membership with a hashed expiring setup token',async()=>{
 const f=invitationFixture(),res=response();await f.controller.inviteAccountant(f.req,res);assert.equal(res.statusCode,201);
 assert.equal(f.user.status,'invited');assert.equal(f.user.role,'member');assert.equal(f.user.isEmailVerified,false);assert.equal(f.user.email,'accountant@example.test');
 assert.equal(f.memberships[0].role,'accountant');assert.equal(f.memberships[0].organizationId,'b');assert.equal(f.memberships[0].isPrimary,true);
 assert.equal(f.tokens[0].type,'reset_password');assert.equal(f.tokens[0].scope,'organization_invite');assert.equal(f.tokens[0].metadata.organizationId,'b');assert.ok(f.tokens[0].expiresAt > new Date());
 const raw=new URL(f.sent[0].setPasswordUrl).searchParams.get('token');assert.notEqual(raw,f.tokens[0].tokenHash);assert.equal(require('crypto').createHash('sha256').update(raw).digest('hex'),f.tokens[0].tokenHash);assert.equal(f.sent[0].loginUrl,undefined);
});
test('existing accountant invitation preserves primary organization, global role and password, and sends a sign-in link',async()=>{
 const f=invitationFixture(true),res=response();await f.controller.inviteAccountant(f.req,res);assert.equal(res.statusCode,201);
 assert.equal(f.user.organizationId,'a');assert.equal(f.user.role,'administrator');assert.equal(f.memberships[0].isPrimary,false);assert.equal(f.tokens.length,0);assert.equal(f.updates.length,0);assert.equal(f.sent[0].setPasswordUrl,undefined);assert.ok(f.sent[0].loginUrl.endsWith('/login'));
});
test('accountant invitation validates email/new names, administrator permission and organization scope before writing',async()=>{
 for(const variant of ['role','scope','email','name']){
  const f=invitationFixture(),res=response();
  if(variant==='role')f.req.auth.roleCodes=['accountant'];if(variant==='scope')f.req.params.id='a';if(variant==='email')f.req.body.email='bad';if(variant==='name')f.req.body.firstName='';
  await f.controller.inviteAccountant(f.req,res);assert.equal(res.statusCode,variant==='role'?403:variant==='scope'?404:400,variant);assert.equal(f.memberships.length,0);assert.equal(f.sent.length,0);
 }
});
test('existing different organization role is not silently downgraded by an accountant invitation',async()=>{
 const f=invitationFixture(true),res=response();f.memberships.push({role:'administrator',isActive:true});await f.controller.inviteAccountant(f.req,res);assert.equal(res.statusCode,409);assert.equal(f.sent.length,0);assert.equal(f.tokens.length,0);
});
test('email failures retain membership with an explicit retryable result; repeated invitations reuse the membership',async()=>{
 const f=invitationFixture(true);let attempts=0;
 const controller=load('../src/controllers/organizations-controller',f.models,{'../services/email-service':{sendOrganizationUserInviteEmail:async()=>{if(++attempts===1)throw new Error('Mock delivery failure');}}});
 const first=response();await controller.inviteAccountant(f.req,first);assert.equal(first.statusCode,201);assert.equal(first.body.data.inviteEmail.sent,false);assert.equal(f.memberships.length,1);
 const retry=response();await controller.inviteAccountant(f.req,retry);assert.equal(retry.statusCode,200);assert.equal(retry.body.data.inviteEmail.sent,true);assert.equal(f.memberships.length,1);
});
test('removing membership revokes its access tokens and disconnects its sockets without affecting the other organization',async()=>{
 const f=invitationFixture(true);f.req.params.userId=f.user.id;
 f.memberships.push({id:'membership',organizationId:'b',userId:f.user.id,role:'accountant',isActive:true,isPrimary:false});
 f.models.OrganizationUser.destroy=async()=>{f.memberships.length=0;return 1;};
 let revoked=0,disconnected=0,deletedRoles=0;
 f.models.Token.findAll=async()=>[{metadata:{organizationId:'b'},update:async()=>revoked++},{metadata:{organizationId:'a'},update:async()=>assert.fail('Must preserve tokens for the other organization')}];
 f.models.OrganizationUserRole={destroy:async options=>{assert.equal(options.where.organizationId,'b');deletedRoles++;}};
 const controller=load('../src/controllers/organizations-controller',f.models,{'../services/socket-service':{getSocketServer:()=>({in:()=>({fetchSockets:async()=>[{data:{auth:{organizationId:'b'}},disconnect:()=>disconnected++},{data:{auth:{organizationId:'a'}},disconnect:()=>assert.fail('Other organization socket must stay connected')}]})})}});
 const res=response();await controller.removeUserFromOrganization(f.req,res);assert.equal(res.statusCode,200);assert.equal(revoked,1);assert.equal(disconnected,1);assert.equal(deletedRoles,1);assert.equal(f.user.organizationId,'a');
});
test('invitation emails preserve escaping and use the correct existing/new account action',()=>{
 const {buildOrganizationUserInviteTemplate}=require('../src/templates/emails/organization-user-invite-template');
 const existing=buildOrganizationUserInviteTemplate({recipientName:'<A>',organizationName:'Company & Co',loginUrl:'https://example.test/login'});
 assert.ok(existing.html.includes('&lt;A&gt;'));assert.ok(existing.html.includes('Company &amp; Co'));assert.ok(existing.text.includes('Your password has not changed.'));assert.ok(existing.html.includes('Sign In'));assert.ok(!existing.html.includes('Set Password'));
 const invited=buildOrganizationUserInviteTemplate({setPasswordUrl:'https://example.test/reset-password?token=sample',expiresInMinutes:30});assert.ok(invited.html.includes('Set Password'));assert.ok(invited.text.includes('30 minutes'));
});

test('actual module routes reject accountant write requests and cheque/bank access before controllers run',async()=>{
 const express=require('express'),app=express();app.use(express.json());
 app.use((req,res,next)=>{req.auth={roleCodes:['accountant'],permissions:new Set(ACCOUNTANT_PERMISSIONS),isPrivileged:false,user:{organizationId:'b'},userId:'person'};next();});
 for(const name of ['expenses','sales-invoices','vendors','customers','reports','organizations','banks','cheques','withholding-tax-types'])app.use('/'+name,require('../src/routes/'+name+'-routes'));
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const [method,url] of [['POST','/expenses'],['PATCH','/expenses/id'],['DELETE','/expenses/id'],['POST','/expenses/import'],['POST','/sales-invoices'],['PATCH','/sales-invoices/id'],['DELETE','/sales-invoices/id'],['POST','/vendors'],['PATCH','/vendors/id'],['DELETE','/vendors/id'],['POST','/customers'],['PATCH','/customers/id'],['DELETE','/customers/id'],['DELETE','/reports/quarterly-sales/id'],['DELETE','/reports/quarterly-expenses/id'],['PATCH','/organizations/b'],['POST','/organizations/b/invitations'],['POST','/organizations/b/accountant-invitations'],['POST','/organizations/b/users'],['DELETE','/organizations/b/users/person'],['GET','/banks'],['GET','/cheques'],['POST','/withholding-tax-types'],['PUT','/withholding-tax-types/id'],['DELETE','/withholding-tax-types/id']]){
   const res=await fetch(base+url,{method,headers:{'content-type':'application/json'},...(method==='GET'?{}:{body:'{}'})});assert.equal(res.status,403,method+' '+url);
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('accountant notifications exclude unrelated modules and cannot bypass the filter with an entity query',async()=>{
 const {Op}=require('sequelize');const calls=[];
 const models={Message:{count:async({where})=>{calls.push(where);return 0;},findAndCountAll:async({where})=>{calls.push(where);return {rows:[],count:0};}},Organization:{},User:{}};
 const controller=load('../src/controllers/messages-controller',models),req={auth:{roleCodes:['accountant'],user:{organizationId:'b'}},query:{organizationId:'a',entityType:'item'}};
 await controller.getUnreadMessageCount(req,response());assert.equal(calls[0].organizationId,'b');assert.ok(!calls[0].entityType[Op.in].includes('item'));
 await controller.listMessages(req,response());assert.equal(calls[1].organizationId,'b');assert.equal(calls[1].entityType[Op.in].length,0);
});

test('existing accountant permissions migration removes historic writes and keeps only review/report grants',async()=>{
 const grants=[];let removed=false;
 const q={sequelize:{transaction:async cb=>cb({}),query:async sql=>sql.includes("code = 'customers.read'")?[[{id:'customer-permission'}]]:sql.includes('FROM roles')?[[{id:'accountant-role'}]]:[[[...ACCOUNTANT_PERMISSIONS,'expenses.create','reports.delete','banks.read'].map((code,index)=>({id:'p'+index,code}))].flat()]},bulkDelete:async(table,where)=>{assert.equal(table,'role_permissions');assert.equal(where.role_id,'accountant-role');removed=true;},bulkInsert:async(table,rows)=>grants.push(...rows)};
 await require('../src/migrations/20261005020000-scope-accountant-permissions').up(q);assert.equal(removed,true);assert.equal(grants.length,ACCOUNTANT_PERMISSIONS.length);assert.ok(grants.every(g=>g.is_allowed&&g.is_active));
});

test('administrators and superusers can invite standard users to their authorized organizations without changing global roles',async()=>{
 for(const actorRole of ['administrator','superuser']){
  const f=invitationFixture(true),res=response();f.req.auth.roleCodes=[actorRole];f.req.body.roleId='enduser-role';
  if(actorRole==='superuser')f.req.auth.user.organizationId='a';
  await f.controller.inviteOrganizationUser(f.req,res,()=>assert.fail('Unexpected Express next callback'));assert.equal(res.statusCode,201);assert.equal(res.body.data.role,'enduser');assert.equal(f.memberships[0].organizationId,'b');assert.equal(f.user.organizationId,'a');assert.equal(f.user.role,'administrator');assert.equal(f.tokens.length,0);
 }
});
test('organization invitation rejects staff, other organizations, inactive roles and global superuser assignment',async()=>{
 for(const variant of ['staff','other-organization','superuser-role','inactive-role']){
  const f=invitationFixture(true),res=response();f.req.body.roleId='enduser-role';
  if(variant==='staff')f.req.auth.roleCodes=['enduser'];if(variant==='other-organization')f.req.auth.user.organizationId='a';if(variant==='superuser-role')f.req.body.roleId='super-role';if(variant==='inactive-role')f.models.Role.findByPk=async()=>({code:'enduser',isActive:false});
  await f.controller.inviteOrganizationUser(f.req,res);assert.equal(res.statusCode,variant==='staff'?403:variant==='other-organization'?404:400,variant);assert.equal(f.memberships.length,0);assert.equal(f.sent.length,0);
 }
});
test('the existing add-user endpoint assigns the chosen organization role without granting a global UserRole',async()=>{
 const f=invitationFixture(true),res=response();f.req.body={userId:f.user.id,roleId:'accountant-role'};
 await f.controller.addUserToOrganization(f.req,res);assert.equal(res.statusCode,201);assert.equal(f.memberships[0].role,'accountant');assert.equal(f.user.role,'administrator');assert.equal(f.user.organizationId,'a');
});
test('new user completes the invitation password setup and becomes verified and active',async()=>{
 const f=invitationFixture();await f.controller.inviteAccountant(f.req,response());
 const raw=new URL(f.sent[0].setPasswordUrl).searchParams.get('token');let consumed=false;
 f.models.Token.findOne=async options=>{assert.equal(options.where.tokenHash,f.tokens[0].tokenHash);assert.equal(options.where.type,'reset_password');return {...f.tokens[0],user:f.user};};
 f.models.Token.update=async()=>{consumed=true;};
 const controller=load('../src/controllers/auth-controller',f.models),res=response();
 await controller.resetPassword({body:{token:raw,newPassword:'SyntheticPass123',confirmPassword:'SyntheticPass123'}},res);
 assert.equal(res.statusCode,200);assert.equal(f.user.isEmailVerified,true);assert.equal(f.user.status,'active');assert.equal(f.user.organizationId,'b');assert.equal(consumed,true);
});
test('organization administrator preset is scoped to the selected membership and grants no inherited access elsewhere',async()=>{
 const f=fixture();f.roles.length=0;f.memberships[1].role='administrator';f.models.Role.findOne=async()=>({code:'administrator',permissions:[{code:'organizations.update'}]});
 const b=await effectiveRoleAccess(f.models,f.user,'b');assert.deepEqual(b.roleCodes,['administrator']);assert.ok(b.permissions.has('organizations.update'));
 assert.equal((await effectiveRoleAccess(f.models,f.user,'c')).permissions.size,0);
});
test('standard membership cannot inherit global administrator rights from another organization',async()=>{
 const f=fixture();f.memberships[1].role='enduser';f.models.Role.findOne=async()=>({code:'enduser',permissions:[{code:'orders.read'}]});
 const b=await effectiveRoleAccess(f.models,f.user,'b');assert.deepEqual(b.roleCodes,['enduser']);assert.deepEqual([...b.permissions],['orders.read']);assert.ok(!(b.roleCodes.includes('administrator')));
});
test('removing the last primary membership clears the legacy organization fallback in the same transaction',async()=>{
 const f=invitationFixture(true);f.user.organizationId='b';f.req.params.userId=f.user.id;f.memberships.push({organizationId:'b',userId:f.user.id,role:'accountant',isPrimary:true});
 f.models.OrganizationUser.destroy=async options=>{assert.ok(options.transaction);f.memberships.length=0;};
 f.models.Token.findAll=async()=>[];
 f.models.User.update=async(payload,options)=>{assert.ok(options.transaction);Object.assign(f.user,payload);};
 const res=response();await f.controller.removeUserFromOrganization(f.req,res);assert.equal(res.statusCode,200);assert.equal(f.user.organizationId,null);
});

test('real organization invitation route accepts an administrator request and assigns the selected scoped role',async()=>{
 const f=invitationFixture(true),express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>{req.auth=f.req.auth;req.auth.isPrivileged=true;next();});
 const router=load('../src/routes/organizations-routes',f.models,{'../controllers/organizations-controller':f.controller});app.use('/organizations',router);
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try{
  const res=await fetch(`http://127.0.0.1:${server.address().port}/organizations/b/invitations`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.user.email,roleId:'enduser-role'})});
  assert.equal(res.status,201);const body=await res.json();assert.equal(body.data.role,'enduser');assert.equal(f.user.organizationId,'a');assert.equal(f.user.role,'administrator');assert.equal(f.sent.length,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
