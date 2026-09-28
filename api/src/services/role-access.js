const {Op}=require('sequelize');
const {fail}=require('./debt-amounts');
const ADMIN_CODES=new Set(['administrator','superuser','admin','superadmin']);
const RESTRICTED_RESOURCES=new Set(['roles','permissions','organizations','licenses','settings','banks']);
function organizationPermissionAllowed(permission){const code=String(permission.code||'').toLowerCase();return !code.includes('*')&&!RESTRICTED_RESOURCES.has(code.split('.')[0]);}
function requireRoleAdministrator(req,res,next){if(!req.auth)return res.status(401).json({message:'Authentication required.'});if(!(req.auth.roleCodes||[]).some(c=>['administrator','superuser'].includes(String(c).toLowerCase())))return res.status(403).json({message:'Only administrators can manage role assignments.'});return next();}
function requireGlobalRoleAdministrator(req,res,next){if(!req.auth)return res.status(401).json({message:'Authentication required.'});if(!(req.auth.roleCodes||[]).includes('superuser'))return res.status(403).json({message:'Global roles and permissions can only be changed by a superuser. Use Organization roles for your team.'});return next();}
function organizationAdminScope(req){
 if(!(req.auth?.roleCodes||[]).includes('administrator'))throw fail(403,'Only this organization’s administrator can manage its roles.');
 const id=req.auth?.user?.organizationId;if(!id)throw fail(400,'Sign in to an organization first.');
 if(req.query?.organizationId&&req.query.organizationId!==id)throw fail(403,'You cannot manage another organization’s roles.');
 return id;
}
async function activeMember(models,userId,organizationId,transaction){
 const user=await models.User.findByPk(userId,{transaction});if(!user||!user.isActive||user.status!=='active')return null;
 const membership=await models.OrganizationUser.findOne({where:{userId,organizationId},transaction});
 if(membership)return membership.isActive?user:null;
 return user.organizationId===organizationId?user:null;
}
async function effectiveRoleAccess(models,user,organizationId){
 const roleCodes=[],permissions=new Set();
 const legacy=await models.UserRole.findAll({where:{userId:user.id,isActive:true},include:[{model:models.Role,as:'role',required:true,where:{isActive:true},include:[{model:models.Permission,as:'permissions',required:false,where:{isActive:true},through:{where:{isActive:true,isAllowed:true},attributes:[]}}]}]});
 for(const assignment of legacy){const role=assignment.role,code=String(role.code||'').toLowerCase();if(code==='administrator'&&organizationId!==user.organizationId)continue;roleCodes.push(code);for(const p of role.permissions||[])permissions.add(String(p.code).toLowerCase());}
 if(organizationId&&models.OrganizationUserRole&&await activeMember(models,user.id,organizationId)){
  const assigned=await models.OrganizationUserRole.findAll({where:{userId:user.id,organizationId},include:[{model:models.OrganizationRole,as:'role',required:true,where:{organizationId,isActive:true},include:[{model:models.Permission,as:'permissions',required:false,where:{isActive:true},through:{attributes:[]}}]}]});
  for(const assignment of assigned){const role=assignment.role;roleCodes.push(`org:${role.code}`);for(const p of role.permissions||[])if(organizationPermissionAllowed(p))permissions.add(String(p.code).toLowerCase());}
 }
 return {roleCodes:[...new Set(roleCodes)],permissions};
}
module.exports={ADMIN_CODES,organizationPermissionAllowed,requireRoleAdministrator,requireGlobalRoleAdministrator,organizationAdminScope,activeMember,effectiveRoleAccess};
