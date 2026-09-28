const {Op}=require('sequelize');
const {getModels}=require('../sequelize');
const {fail}=require('../services/debt-amounts');
const {ADMIN_CODES,organizationPermissionAllowed,organizationAdminScope,activeMember}=require('../services/role-access');
function endpoint(fn){return async(req,res)=>{res.set('Cache-Control','private, no-store');try{const organizationId=organizationAdminScope(req);const models=getModels();const actor=await activeMember(models,req.auth.userId,organizationId);if(!actor||actor.organizationId!==organizationId)throw fail(403,'Only this organization’s administrator can manage its roles.');await fn(req,res,models,organizationId);}catch(e){res.status(e.status||(e.name==='SequelizeUniqueConstraintError'?409:500)).json({message:e.status?e.message:e.name==='SequelizeUniqueConstraintError'?'A role with that name or code already exists in this organization.':'Unable to complete this role action.'});}};}
function values(body){
 const name=String(body.name||'').trim(),code=String(body.code||'').trim().toLowerCase(),description=String(body.description||'').trim();
 if(!name||name.length>100||!/^[a-z][a-z0-9_]{0,99}$/.test(code)||ADMIN_CODES.has(code)||description.length>2000||typeof body.isActive!=='boolean')throw fail(400,'Enter a role name, a non-reserved code (letters, numbers and underscores), and a valid status.');
 if(body.isSystem)throw fail(403,'Organization roles cannot be system roles.');
 return {name,code,description,isActive:body.isActive};
}
async function findRole(m,id,organizationId,transaction){const role=await m.OrganizationRole.findOne({where:{id,organizationId},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});if(!role)throw fail(404,'Organization role not found.');return role;}
async function write(m,organizationId,fn){return m.OrganizationRole.sequelize.transaction(async transaction=>{await m.Organization.findByPk(organizationId,{transaction,lock:transaction.LOCK.UPDATE});return fn(transaction);});}
const list=endpoint(async(req,res,m,organizationId)=>{
 const rows=await m.OrganizationRole.findAll({where:{organizationId},order:[['name','ASC']],include:[{model:m.Permission,as:'permissions',through:{attributes:[]}},{model:m.User,as:'members',attributes:['id','firstName','lastName','email','isActive'],through:{attributes:[]}}]});res.json({data:rows});
});
const options=endpoint(async(req,res,m,organizationId)=>{
 const permissions=(await m.Permission.findAll({where:{isActive:true},order:[['code','ASC']]})).filter(organizationPermissionAllowed);
 const memberships=await m.OrganizationUser.findAll({where:{organizationId},attributes:['userId','isActive']});
 const active=memberships.filter(x=>x.isActive).map(x=>x.userId),inactive=memberships.filter(x=>!x.isActive).map(x=>x.userId);
 const members=await m.User.findAll({where:{isActive:true,status:'active',[Op.or]:[{id:{[Op.in]:active}},{organizationId,id:{[Op.notIn]:inactive}}]},attributes:['id','firstName','lastName','email'],order:[['firstName','ASC']]});
 res.json({data:{permissions,members}});
});
const create=endpoint(async(req,res,m,organizationId)=>{const payload=values(req.body||{});const role=await write(m,organizationId,transaction=>m.OrganizationRole.create({...payload,organizationId},{transaction}));res.status(201).json({data:role,message:'Organization role created.'});});
const update=endpoint(async(req,res,m,organizationId)=>{const payload=values(req.body||{});await write(m,organizationId,async t=>{const role=await findRole(m,req.params.id,organizationId,t);await role.update(payload,{transaction:t});});res.json({message:'Organization role updated.'});});
const remove=endpoint(async(req,res,m,organizationId)=>{await write(m,organizationId,async t=>{const role=await findRole(m,req.params.id,organizationId,t);await role.destroy({transaction:t});});res.json({message:'Role deleted and its organization assignments removed.'});});
const grant=endpoint(async(req,res,m,organizationId)=>{await write(m,organizationId,async t=>{const role=await findRole(m,req.params.id,organizationId,t);const p=await m.Permission.findOne({where:{id:req.body?.permissionId,isActive:true},transaction:t});if(!p)throw fail(404,'Permission not found.');if(!organizationPermissionAllowed(p))throw fail(403,'This permission is restricted to platform administrators.');await m.OrganizationRolePermission.findOrCreate({where:{roleId:role.id,permissionId:p.id},transaction:t});});res.json({message:'Permission granted.'});});
const revoke=endpoint(async(req,res,m,organizationId)=>{await write(m,organizationId,async t=>{await findRole(m,req.params.id,organizationId,t);await m.OrganizationRolePermission.destroy({where:{roleId:req.params.id,permissionId:req.params.permissionId},transaction:t});});res.json({message:'Permission removed.'});});
const assign=endpoint(async(req,res,m,organizationId)=>{await write(m,organizationId,async t=>{const role=await findRole(m,req.params.id,organizationId,t);if(!role.isActive)throw fail(409,'Activate the role before assigning it.');if(!await activeMember(m,req.body?.userId,organizationId,t))throw fail(404,'Active organization member not found.');await m.OrganizationUserRole.findOrCreate({where:{organizationId,roleId:role.id,userId:req.body.userId},transaction:t});});res.json({message:'Role assigned to organization member.'});});
const unassign=endpoint(async(req,res,m,organizationId)=>{await write(m,organizationId,async t=>{await findRole(m,req.params.id,organizationId,t);await m.OrganizationUserRole.destroy({where:{organizationId,roleId:req.params.id,userId:req.params.userId},transaction:t});});res.json({message:'Role assignment removed.'});});
module.exports={list,options,create,update,remove,grant,revoke,assign,unassign};
