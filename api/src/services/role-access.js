const {fail}=require('./debt-amounts');
const { ACCOUNTANT_PERMISSIONS, ORGANIZATION_PRESET_ROLES } = require('./accountant-access');
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
async function effectiveRoleAccess(models, user, organizationId) {
  const roleCodes = [], permissions = new Set();
  const permissionInclude = {model:models.Permission,as:'permissions',required:false,where:{isActive:true},
    through:{where:{isActive:true,isAllowed:true},attributes:[]}};
  const legacy = await models.UserRole.findAll({where:{userId:user.id,isActive:true},include:[{
    model:models.Role,as:'role',required:true,where:{isActive:true},include:[permissionInclude],
  }]});
  const membership = organizationId ? await models.OrganizationUser.findOne({where:{userId:user.id,organizationId}}) : null;
  const isSuperuser = legacy.some(a => String(a.role.code).toLowerCase() === 'superuser');
  const membershipRole = membership?.isActive ? String(membership.role || '').toLowerCase() : '';
  // An organization role never inherits global rights from another company.
  // Accountants remain capped even when old/global/custom roles have write grants.
  if (!isSuperuser && membershipRole === 'accountant') {
    return {roleCodes:['accountant'],permissions:new Set(ACCOUNTANT_PERMISSIONS)};
  }
  if (!isSuperuser && ORGANIZATION_PRESET_ROLES.includes(membershipRole)) {
    const preset = await models.Role.findOne({where:{code:membershipRole,isActive:true},include:[permissionInclude]});
    if (preset) {
      roleCodes.push(membershipRole);
      for (const permission of preset.permissions || []) permissions.add(String(permission.code).toLowerCase());
    }
  } else {
    // Legacy global roles apply only to the primary organization. Superusers
    // retain platform access; scoped invitations require no global assignment.
    for (const assignment of legacy) {
      const role = assignment.role, code = String(role.code || '').toLowerCase();
      if (code !== 'superuser' && organizationId && organizationId !== user.organizationId) continue;
      if (code === 'accountant') {
        if (!organizationId || membership || organizationId !== user.organizationId) continue;
        roleCodes.push(code);
        for (const permission of ACCOUNTANT_PERMISSIONS) permissions.add(permission);
      } else {
        roleCodes.push(code);
        for (const permission of role.permissions || []) permissions.add(String(permission.code).toLowerCase());
      }
    }
  }
  if (organizationId && models.OrganizationUserRole && await activeMember(models,user.id,organizationId)) {
    const assigned = await models.OrganizationUserRole.findAll({where:{userId:user.id,organizationId},include:[{
      model:models.OrganizationRole,as:'role',required:true,where:{organizationId,isActive:true},include:[{
        model:models.Permission,as:'permissions',required:false,where:{isActive:true},through:{attributes:[]},
      }],
    }]});
    for (const assignment of assigned) {
      const role = assignment.role;
      roleCodes.push(`org:${role.code}`);
      for (const permission of role.permissions || []) if (organizationPermissionAllowed(permission)) permissions.add(String(permission.code).toLowerCase());
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
