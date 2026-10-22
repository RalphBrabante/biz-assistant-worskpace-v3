const express = require('express');
const {
  createRole,
  listRoles,
  getRoleById,
  updateRole,
  deleteRole,
  listRoleAssignablePermissions,
  addPermissionToRole,
  removePermissionFromRole,
} = require('../controllers/roles-controller');
const { authorize } = require('../middleware/authz');
const { requireGlobalRoleAdministrator } = require('../services/role-access');

const router = express.Router();

router.post('/', requireGlobalRoleAdministrator, authorize('roles.manage'), createRole);
router.get('/', authorize('roles.manage'), listRoles);
router.get('/:id', authorize('roles.manage'), getRoleById);
router.get('/:id/assignable-permissions', authorize('roles.manage'), listRoleAssignablePermissions);
router.post('/:id/permissions', requireGlobalRoleAdministrator, authorize('roles.manage'), addPermissionToRole);
router.delete('/:id/permissions/:permissionId', requireGlobalRoleAdministrator, authorize('roles.manage'), removePermissionFromRole);
router.put('/:id', requireGlobalRoleAdministrator, authorize('roles.manage'), updateRole);
router.patch('/:id', requireGlobalRoleAdministrator, authorize('roles.manage'), updateRole);
router.delete('/:id', requireGlobalRoleAdministrator, authorize('roles.manage'), deleteRole);

module.exports = router;
