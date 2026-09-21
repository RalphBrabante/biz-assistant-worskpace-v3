const express = require('express');
const {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  listUserAssignableRoles,
  addRoleToUser,
  removeRoleFromUser,
  listUserAssignableOrganizations,
  addOrganizationToUser,
  removeOrganizationFromUser,
} = require('../controllers/users-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('users.create'), createUser);
router.get('/', authorize('users.read'), listUsers);
router.get('/:id', authorize('users.read'), getUserById);
router.get('/:id/assignable-roles', authorize('users.read'), listUserAssignableRoles);
router.get('/:id/assignable-organizations', authorize('users.read'), listUserAssignableOrganizations);
router.post('/:id/roles', authorize('users.update'), addRoleToUser);
router.delete('/:id/roles/:roleId', authorize('users.update'), removeRoleFromUser);
router.post('/:id/organizations', authorize('users.update'), addOrganizationToUser);
router.delete('/:id/organizations/:organizationId', authorize('users.update'), removeOrganizationFromUser);
router.put('/:id', authorize('users.update'), updateUser);
router.patch('/:id', authorize('users.update'), updateUser);
router.delete('/:id', authorize('users.delete'), deleteUser);

module.exports = router;
