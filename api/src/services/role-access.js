const {fail}=require('./debt-amounts');
const { ACCOUNTANT_PERMISSIONS } = require('./accountant-access');
const ADMIN_CODES=new Set(['administrator','superuser','admin','superadmin']);
const RESTRICTED_RESOURCES=new Set(['roles','permissions','organizations','licenses','settings','banks']);
function organizationPermissionAllowed(permission){const code=String(permission.code||'').toLowerCase();return !code.includes('*')&&!RESTRICTED_RESOURCES.has(code.split('.')[0]);}
function requireRoleAdministrator(req,res,next){if(!req.auth)return res.status(401).json({message:'Authentication required.'});if(!(req.auth.roleCodes||[]).some(c=>['administrator','superuser'].includes(String(c).toLowerCase())))return res.status(403).json({message:'Only administrators can manage role assignments.'});return next();}
function requireGlobalRoleAdministrator(req,res,next){if(!req.auth)return res.status(401).json({message:'Authentication required.'});if(!(req.auth.roleCodes||[]).includes('superuser'))return res.status(403).json({message:'Global roles and permissions can only be changed by a superuser. Use Organization roles for your team.'});return next();}
function organizationAdminScope(req){
 const roleCodes=req.auth?.roleCodes||[];
 // Platform staff act on one organization at a time and must name it. Every change is audited.
 if(roleCodes.includes('superuser')){const id=String(req.query?.organizationId||'').trim();if(!id)throw fail(400,'Select an organization to manage its roles.');return id;}
 if(!roleCodes.includes('administrator'))throw fail(403,'Only this organization’s administrator can manage its roles.');
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
async function effectiveRoleAccess(models, user, organizationId) {
  const roleCodes = [], permissions = new Set();
  const permissionInclude = {model:models.Permission,as:'permissions',required:false,where:{isActive:true},
    through:{where:{isActive:true,isAllowed:true},attributes:[]}};
  // Superuser is the only role that exists outside an organization.
  const platform = (await models.UserRole.findAll({where:{userId:user.id,isActive:true},include:[{
    model:models.Role,as:'role',required:true,where:{isActive:true},include:[permissionInclude],
  }]})).filter(assignment => String(assignment.role.code).toLowerCase() === 'superuser');
  const isSuperuser = platform.length > 0;
  for (const assignment of platform) {
    roleCodes.push('superuser');
    for (const permission of assignment.role.permissions || []) permissions.add(String(permission.code).toLowerCase());
  }
  // Everything else comes from the roles this organization owns and has assigned to this member.
  if (organizationId && models.OrganizationUserRole && await activeMember(models,user.id,organizationId)) {
    const assigned = await models.OrganizationUserRole.findAll({where:{userId:user.id,organizationId},include:[{
      model:models.OrganizationRole,as:'role',required:true,where:{organizationId,isActive:true},include:[{
        model:models.Permission,as:'permissions',required:false,where:{isActive:true},through:{attributes:[]},
      }],
    }]});
    // Accountants remain capped even when they also hold roles with write grants.
    if (!isSuperuser && assigned.some(assignment => assignment.role.presetCode === 'accountant')) {
      return {roleCodes:['accountant'],permissions:new Set(ACCOUNTANT_PERMISSIONS)};
    }
    for (const assignment of assigned) {
      const role = assignment.role;
      roleCodes.push(role.presetCode || `org:${role.code}`);
      // Custom roles can never hold platform-only permissions, even if a row was written by hand.
      // System roles and roles copied from an existing global role keep what the backfill gave them.
      const trusted = Boolean(role.presetCode || role.legacyRoleId);
      for (const permission of role.permissions || []) {
        if (trusted || organizationPermissionAllowed(permission)) permissions.add(String(permission.code).toLowerCase());
      }
    }
  }
  return {roleCodes:[...new Set(roleCodes)],permissions};
}
async function resolveTokenOrganizationId(models, user, token, fallbackOrganizationId) {
 const id = String(token?.metadata?.organizationId || fallbackOrganizationId || '').trim() || null;
 if (!id || !await activeMember(models, user.id, id)) throw fail(401, 'Token organization scope is no longer valid for this user.');
 return id;
}
module.exports={ADMIN_CODES,organizationPermissionAllowed,requireRoleAdministrator,requireGlobalRoleAdministrator,organizationAdminScope,activeMember,effectiveRoleAccess,resolveTokenOrganizationId};
