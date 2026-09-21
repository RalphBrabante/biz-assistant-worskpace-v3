const express = require('express');
const {
  createOrganization,
  listOrganizations,
  getOrganizationById,
  listOrganizationUsers,
  searchAssignableUsers,
  listOrganizationAssignableRoles,
  addUserToOrganization,
  removeUserFromOrganization,
  updateOrganization,
  deleteOrganization,
} = require('../controllers/organizations-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('organizations.update'), createOrganization);
router.get('/', authorize('organizations.read'), listOrganizations);
router.get('/:id', authorize('organizations.read'), getOrganizationById);
router.get('/:id/users', authorize('organizations.read'), listOrganizationUsers);
router.get('/:id/assignable-users', authorize('organizations.read'), searchAssignableUsers);
router.get('/:id/assignable-roles', authorize('organizations.read'), listOrganizationAssignableRoles);
router.post('/:id/users', authorize('organizations.update'), addUserToOrganization);
router.delete('/:id/users/:userId', authorize('organizations.update'), removeUserFromOrganization);
router.put('/:id', authorize('organizations.update'), updateOrganization);
router.patch('/:id', authorize('organizations.update'), updateOrganization);
router.delete('/:id', authorize('organizations.update'), deleteOrganization);

module.exports = router;
