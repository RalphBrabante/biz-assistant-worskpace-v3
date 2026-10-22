const express = require('express');
const {
  createPermission,
  listPermissions,
  getPermissionById,
  updatePermission,
  deletePermission,
} = require('../controllers/permissions-controller');
const { authorize } = require('../middleware/authz');
const { requireGlobalRoleAdministrator } = require('../services/role-access');

const router = express.Router();

router.post('/', requireGlobalRoleAdministrator, authorize('permissions.manage'), createPermission);
router.get('/', authorize('permissions.manage'), listPermissions);
router.get('/:id', authorize('permissions.manage'), getPermissionById);
router.put('/:id', requireGlobalRoleAdministrator, authorize('permissions.manage'), updatePermission);
router.patch('/:id', requireGlobalRoleAdministrator, authorize('permissions.manage'), updatePermission);
router.delete('/:id', requireGlobalRoleAdministrator, authorize('permissions.manage'), deletePermission);

module.exports = router;
