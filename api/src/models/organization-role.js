const { Model, DataTypes: D } = require('sequelize');

class OrganizationRole extends Model {}
class OrganizationRolePermission extends Model {}
class OrganizationUserRole extends Model {}
class OrganizationRoleAuditLog extends Model {}

function initOrganizationRoleModels(sequelize) {
  const id = () => ({ type: D.UUID, primaryKey: true, defaultValue: D.UUIDV4 });
  const ref = () => ({ type: D.UUID, allowNull: false });
  const optionalRef = () => ({ type: D.UUID, allowNull: true });
  const options = (modelName, tableName) => ({ sequelize, modelName, tableName, timestamps: true, underscored: true });

  OrganizationRole.init({
    id: id(),
    organizationId: ref(),
    name: { type: D.STRING(100), allowNull: false },
    code: { type: D.STRING(100), allowNull: false },
    description: D.TEXT,
    isActive: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
    // Set on the system roles every organization owns. NULL means a custom role.
    presetCode: { type: D.STRING(50), allowNull: true },
    legacyRoleId: optionalRef(),
    createdByUserId: optionalRef(),
    updatedByUserId: optionalRef(),
  }, options('OrganizationRole', 'organization_roles'));

  OrganizationRolePermission.init({ id: id(), roleId: ref(), permissionId: ref() },
    options('OrganizationRolePermission', 'organization_role_permissions'));

  OrganizationUserRole.init({
    id: id(),
    organizationId: ref(),
    roleId: ref(),
    userId: ref(),
    assignedByUserId: optionalRef(),
  }, options('OrganizationUserRole', 'organization_user_roles'));

  OrganizationRoleAuditLog.init({
    id: id(),
    organizationId: ref(),
    actorUserId: optionalRef(),
    action: { type: D.STRING(60), allowNull: false },
    roleId: optionalRef(),
    roleName: { type: D.STRING(100), allowNull: true },
    targetUserId: optionalRef(),
    details: { type: D.JSON, allowNull: true },
  }, { ...options('OrganizationRoleAuditLog', 'organization_role_audit_logs'), updatedAt: false });
}

module.exports = {
  OrganizationRole,
  OrganizationRolePermission,
  OrganizationUserRole,
  OrganizationRoleAuditLog,
  initOrganizationRoleModels,
};
