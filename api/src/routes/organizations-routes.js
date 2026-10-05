const express = require('express');
const {
  createOrganization,
  listOrganizations,
  getOrganizationById,
  listOrganizationUsers,
  searchAssignableUsers,
  listOrganizationAssignableRoles,
  addUserToOrganization,
  inviteAccountant,
  inviteOrganizationUser,
  removeUserFromOrganization,
  updateOrganization,
  deleteOrganization,
} = require('../controllers/organizations-controller');
const { authorize } = require('../middleware/authz');
const { requireRoleAdministrator } = require('../services/role-access');

const router = express.Router();

router.post('/', authorize('organizations.update'), createOrganization);
router.get('/', authorize('organizations.read'), listOrganizations);
router.get('/:id', authorize(['organizations.read', 'reports.read']), getOrganizationById);
router.get('/:id/users', authorize('organizations.read'), listOrganizationUsers);
router.get('/:id/assignable-users', requireRoleAdministrator, authorize('organizations.read'), searchAssignableUsers);
router.get('/:id/assignable-roles', requireRoleAdministrator, authorize('organizations.read'), listOrganizationAssignableRoles);
router.post('/:id/invitations', requireRoleAdministrator, authorize('organizations.update'), inviteOrganizationUser);
router.post('/:id/accountant-invitations', requireRoleAdministrator, authorize('organizations.update'), inviteAccountant);
router.post('/:id/users', requireRoleAdministrator, authorize('organizations.update'), addUserToOrganization);
router.delete('/:id/users/:userId', requireRoleAdministrator, authorize('organizations.update'), removeUserFromOrganization);
router.put('/:id', authorize('organizations.update'), updateOrganization);
router.patch('/:id', authorize('organizations.update'), updateOrganization);
router.delete('/:id', authorize('organizations.update'), deleteOrganization);

module.exports = router;
