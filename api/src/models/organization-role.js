const {Model,DataTypes:D}=require('sequelize');
class OrganizationRole extends Model{} class OrganizationRolePermission extends Model{} class OrganizationUserRole extends Model{}
function initOrganizationRoleModels(sequelize){
 const id=()=>({type:D.UUID,primaryKey:true,defaultValue:D.UUIDV4});const ref=()=>({type:D.UUID,allowNull:false});const options=(modelName,tableName)=>({sequelize,modelName,tableName,timestamps:true,underscored:true});
 OrganizationRole.init({id:id(),organizationId:ref(),name:{type:D.STRING(100),allowNull:false},code:{type:D.STRING(100),allowNull:false},description:D.TEXT,isActive:{type:D.BOOLEAN,allowNull:false,defaultValue:true}},options('OrganizationRole','organization_roles'));
 OrganizationRolePermission.init({id:id(),roleId:ref(),permissionId:ref()},options('OrganizationRolePermission','organization_role_permissions'));
 OrganizationUserRole.init({id:id(),organizationId:ref(),roleId:ref(),userId:ref()},options('OrganizationUserRole','organization_user_roles'));
}
module.exports={OrganizationRole,OrganizationRolePermission,OrganizationUserRole,initOrganizationRoleModels};
