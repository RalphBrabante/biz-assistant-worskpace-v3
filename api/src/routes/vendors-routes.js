const express = require('express');
const {
  listVendors,
  importVendors,
  exportVendors,
  createVendor,
  getVendorById,
  updateVendor,
  deleteVendor,
} = require('../controllers/vendors-controller');
const { authorize } = require('../middleware/authz');
const { uploadImportCsv } = require('../middleware/upload');

const router = express.Router();

router.get('/', authorize('vendors.read'), listVendors);
router.get('/export', authorize('vendors.read'), exportVendors);
router.post('/import', authorize('vendors.create'), uploadImportCsv, importVendors);
router.post('/', authorize('vendors.create'), createVendor);
router.get('/:id', authorize('vendors.read'), getVendorById);
router.put('/:id', authorize('vendors.update'), updateVendor);
router.patch('/:id', authorize('vendors.update'), updateVendor);
router.delete('/:id', authorize('vendors.delete'), deleteVendor);

module.exports = router;
