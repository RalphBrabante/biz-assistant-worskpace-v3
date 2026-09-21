const express = require('express');
const {
  createLicense,
  listLicenses,
  getLicenseById,
  updateLicense,
  deleteLicense,
  revokeLicense,
} = require('../controllers/licenses-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/', authorize('licenses.manage'), createLicense);
router.get('/', authorize('licenses.read'), listLicenses);
router.get('/:id', authorize('licenses.read'), getLicenseById);
router.put('/:id', authorize('licenses.manage'), updateLicense);
router.patch('/:id', authorize('licenses.manage'), updateLicense);
router.post('/:id/revoke', authorize('licenses.manage'), revokeLicense);
router.delete('/:id', authorize('licenses.manage'), deleteLicense);

module.exports = router;
