const express = require('express');
const {
  createLicense,
  listLicenses,
  getLicenseById,
  updateLicense,
  extendLicense,
  deleteLicense,
  revokeLicense,
} = require('../controllers/licenses-controller');
const { authorize } = require('../middleware/authz');
const { requireGlobalRoleAdministrator } = require('../services/role-access');

const router = express.Router();

router.post('/', requireGlobalRoleAdministrator, authorize('licenses.manage'), createLicense);
router.get('/', authorize('licenses.read'), listLicenses);
router.get('/:id', authorize('licenses.read'), getLicenseById);
router.put('/:id', requireGlobalRoleAdministrator, authorize('licenses.manage'), updateLicense);
router.patch('/:id', requireGlobalRoleAdministrator, authorize('licenses.manage'), updateLicense);
router.post('/:id/extend', requireGlobalRoleAdministrator, authorize('licenses.manage'), extendLicense);
router.post('/:id/revoke', requireGlobalRoleAdministrator, authorize('licenses.manage'), revokeLicense);
router.delete('/:id', requireGlobalRoleAdministrator, authorize('licenses.manage'), deleteLicense);

module.exports = router;
