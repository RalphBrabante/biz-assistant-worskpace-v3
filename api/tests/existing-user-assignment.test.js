const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { Op } = require('sequelize');
function fixture() {
  const user = { id: 'person', email: 'shared@example.test', firstName: 'Shared', lastName: 'User', organizationId: 'a', role: 'administrator', password: 'unchanged-hash', isActive: true, status: 'active', isEmailVerified: true, phone: 'private-phone', toJSON() { return { ...this }; }, async update(p, options) { assert.equal(options.transaction, transaction); Object.assign(this, p); } };
  const memberships = [{ userId: user.id, organizationId: 'a', role: 'administrator', isActive: true, isPrimary: true }];
  const calls = [], errors = [], transaction = { LOCK: { UPDATE: 'UPDATE' } };
  let queue = Promise.resolve(), failCreate = false;
  const matches = (m, w) => Object.entries(w).every(([k,v]) => m[k] === v);
  const models = {
    Organization: { findByPk: async id => ['a','b','c'].includes(id) ? { id, name: id, isActive: true } : null },
    Role: { findByPk: async id => ['accountant','enduser','administrator','superuser','custom'].includes(id) ? { id, code: id, isActive: true } : null },
    User: { sequelize: { transaction: callback => {
      const result = queue.then(async () => { const before = memberships.map(m => ({...m})); try { return await callback(transaction); } catch (err) { memberships.splice(0,memberships.length,...before); throw err; } });
      queue = result.catch(() => {}); return result;
    } }, findOne: async options => { calls.push(options); return options.where.email === user.email ? user : null; },
      findByPk: async (id,options) => { assert.equal(options.lock,'UPDATE'); assert.equal(options.transaction,transaction); return id === user.id ? user : null; },
      create: () => assert.fail('Never create an account on assignment'),
      findAndCountAll: async options => { calls.push(options); return { rows:[user],count:1 }; },
    },
    OrganizationUser: {
      findOne: async options => { calls.push(options); return memberships.find(m => matches(m,options.where)); },
      findAll: async options => { calls.push(options); return memberships.filter(m => matches(m,options.where)); },
      count: async options => memberships.filter(m => matches(m,options.where)).length,
      create: async (payload,options) => { assert.equal(options.transaction,transaction); if(failCreate) throw new Error('Injected failure'); memberships.push({...payload}); },
    },
    UserRole: { create: () => assert.fail('Never assign global roles'), bulkCreate: () => assert.fail('Never assign global roles') },
    Token: { create: () => assert.fail('Never reset credentials'), update: () => assert.fail('Never revoke existing sessions') },
  };
  const filename = require.resolve('../src/controllers/users-controller'), actual = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{ module,exports:module.exports,process,Date,console:{error: (...args) => errors.push(args)},require: name => name === '../sequelize' ? {getModels:() => models} : name === '../services/email-service' ? {sendOrganizationUserInviteEmail:() => assert.fail('Assignment sends no email')} : actual(name) });
  const req = { body: { email:' SHARED@example.test ',userId:user.id,organizationId:'b',roleId:'accountant' },query:{},auth:{roleCodes:['administrator'],user:{id:'actor',organizationId:'b'}} };
  const response = () => ({statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},set(){}});
  return {user,memberships,models,req,calls,errors,controller:module.exports,response, failCreate:()=>{failCreate=true;}};
}
test('exact normalized email lookup suggests a minimal identity and reports membership only in the selected organization',async()=>{
  const f=fixture(),res=f.response();await f.controller.lookupExistingUser(f.req,res);
  assert.equal(res.statusCode,200);assert.equal(res.body.data.email,f.user.email);assert.equal(res.body.data.canAssign,true);assert.equal(res.body.data.alreadyAssigned,false);
  for(const field of ['password','phone','status','organizationId','roles','organizations'])assert.equal(res.body.data[field],undefined,field);
  assert.equal(f.calls[0].where.email,'shared@example.test');assert.equal(f.memberships.length,1);
  f.req.body.email='new@example.test';const absent=f.response();await f.controller.lookupExistingUser(f.req,absent);assert.equal(absent.body.data,null);
});
test('assignment adds organization access without altering credentials, global roles, primary organization or other memberships',async()=>{
  const f=fixture(),before={...f.user},res=f.response();await f.controller.assignExistingUser(f.req,res);
  assert.equal(res.statusCode,201);assert.equal(f.memberships.length,2);
  assert.deepEqual(f.memberships[1],{userId:'person',organizationId:'b',role:'accountant',isActive:true,isPrimary:false});
  assert.deepEqual(f.user,before);assert.equal(f.memberships[0].role,'administrator');
  f.req.auth.roleCodes=['superuser'];f.req.body.organizationId='c';await f.controller.assignExistingUser(f.req,f.response());assert.equal(f.memberships.length,3);assert.equal(f.user.organizationId,'a');
});
test('simultaneous and repeated assignment is idempotent and never changes an existing organization role',async()=>{
  const f=fixture(),one=f.response(),two=f.response();await Promise.all([f.controller.assignExistingUser(f.req,one),f.controller.assignExistingUser(f.req,two)]);
  assert.deepEqual([one.statusCode,two.statusCode].sort(),[200,201]);assert.equal(f.memberships.length,2);
  f.req.body.roleId='administrator';const again=f.response();await f.controller.assignExistingUser(f.req,again);assert.equal(again.statusCode,200);assert.equal(again.body.data.alreadyAssigned,true);assert.equal(f.memberships[1].role,'accountant');
  const suggestion=f.response();await f.controller.lookupExistingUser(f.req,suggestion);assert.equal(suggestion.body.data.alreadyAssigned,true);assert.equal(suggestion.body.data.canAssign,false);
});
test('staff, cross-organization requests, bad email, unavailable organization and global/custom roles cannot assign',async()=>{
  const variants=[['staff',403],['scope',403],['email',400],['organization',404],['superuser',400],['custom',400],['missingrole',400],['missinguser',400],['changedemail',409],['inactive',409]];
  for(const [variant,status] of variants){const f=fixture();if(variant==='staff')f.req.auth.roleCodes=['enduser'];if(variant==='scope')f.req.body.organizationId='c';if(variant==='email')f.req.body.email='bad';if(variant==='organization'){f.req.auth.roleCodes=['superuser'];f.req.body.organizationId='missing';}if(['superuser','custom'].includes(variant))f.req.body.roleId=variant;if(variant==='missingrole')delete f.req.body.roleId;if(variant==='missinguser')delete f.req.body.userId;if(variant==='changedemail')f.user.email='changed@example.test';if(variant==='inactive')f.user.isActive=false;const res=f.response();await f.controller.assignExistingUser(f.req,res);assert.equal(res.statusCode,status,variant);assert.equal(f.memberships.length,1,variant);}
  for(const variant of ['staff','scope']){const f=fixture();if(variant==='staff')f.req.auth.roleCodes=['enduser'];else f.req.body.organizationId='c';const res=f.response();await f.controller.lookupExistingUser(f.req,res);assert.equal(res.statusCode,403);assert.equal(f.calls.length,0);}
});
test('inactive membership is reactivated in place using its existing role and no second primary is introduced',async()=>{
  const f=fixture(),membership={userId:'person',organizationId:'b',role:'accountant',isActive:false,isPrimary:true,async update(p,options){assert.ok(options.transaction);Object.assign(this,p);}};f.memberships.push(membership);
  const suggestion=f.response();await f.controller.lookupExistingUser(f.req,suggestion);assert.equal(suggestion.body.data.inactiveMembership,true);assert.equal(suggestion.body.data.membershipRole,'accountant');
  await f.controller.assignExistingUser(f.req,f.response());assert.equal(membership.isActive,true);assert.equal(membership.isPrimary,false);assert.equal(f.memberships.length,2);
});
test('an account with no primary receives its first primary membership; storage failure leaves access unchanged',async()=>{
  const f=fixture();f.user.organizationId=null;f.memberships.length=0;await f.controller.assignExistingUser(f.req,f.response());assert.equal(f.memberships[0].isPrimary,true);assert.equal(f.user.organizationId,'b');
  const failed=fixture();failed.failCreate();const res=failed.response();await failed.controller.assignExistingUser(failed.req,res);assert.equal(res.statusCode,500);assert.equal(failed.memberships.length,1);assert.equal(failed.user.organizationId,'a');assert.ok(!JSON.stringify(failed.errors).includes('unchanged-hash'));
});
test('scoped user list includes active secondary memberships, excludes inactive memberships and uses the scoped role',async()=>{
  const f=fixture();f.memberships.push({userId:'person',organizationId:'b',role:'accountant',isActive:true},{userId:'inactive',organizationId:'b',role:'enduser',isActive:false});f.req.query={q:'shared',role:'accountant',organizationId:'c'};
  const res=f.response();await f.controller.listUsers(f.req,res);assert.equal(res.statusCode,200);
  const options=f.calls.at(-1),scope=options.where[Op.and][0][Op.or];assert.deepEqual(Array.from(scope[0].id[Op.in]),['person']);assert.equal(scope[1].organizationId,'b');assert.ok(scope[1].id[Op.notIn].includes('inactive'));assert.ok(options.where[Op.or]);
  assert.equal(res.body.data[0].role,'accountant');assert.equal(res.body.data[0].canManageAccount,false);assert.equal(res.body.data[0].phone,undefined);assert.equal(res.body.data[0].organizationId,undefined);
});

test('create-flow routes enforce administrator and create-user authorization before lookup or assignment',async()=>{
  const f=fixture(),filename=require.resolve('../src/routes/users-routes'),actual=createRequire(filename),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>name==='../controllers/users-controller'?f.controller:actual(name)});
  const dispatch=async(path,req)=>{const route=module.exports.stack.find(layer=>layer.route?.path===path&&layer.route.methods.post).route;const res=f.response();let cursor=0;const next=async()=>{const layer=route.stack[cursor++];if(layer)await layer.handle(req,res,next);};await next();return res;};
  f.req.auth.permissions=new Set(['users.create']);f.req.auth.roleCodes=['enduser'];
  assert.equal((await dispatch('/lookup-email',f.req)).statusCode,403);assert.equal((await dispatch('/assign-existing',f.req)).statusCode,403);assert.equal(f.calls.length,0);
  f.req.auth.roleCodes=['administrator'];f.req.auth.permissions=new Set();assert.equal((await dispatch('/lookup-email',f.req)).statusCode,403);
  f.req.auth.permissions=new Set(['users.create']);assert.equal((await dispatch('/lookup-email',f.req)).statusCode,200);assert.equal((await dispatch('/assign-existing',f.req)).statusCode,201);
});
