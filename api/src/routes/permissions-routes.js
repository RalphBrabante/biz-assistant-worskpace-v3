const express = require('express');
const {
  createPermission,
  listPermissions,
  getPermissionById,
  updatePermission,
  deletePermission,
} = require('../controllers/permissions-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('permissions.manage'), createPermission);
router.get('/', authorize('permissions.manage'), listPermissions);
router.get('/:id', authorize('permissions.manage'), getPermissionById);
router.put('/:id', authorize('permissions.manage'), updatePermission);
router.patch('/:id', authorize('permissions.manage'), updatePermission);
router.delete('/:id', authorize('permissions.manage'), deletePermission);

module.exports = router;
