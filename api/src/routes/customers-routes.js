const express = require('express');
const {
  createCustomer,
  importCustomers,
  exportCustomers,
  listCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
} = require('../controllers/customers-controller');
const { authorize } = require('../middleware/authz');
const { uploadImportCsv } = require('../middleware/upload');

const router = express.Router();

router.post('/', authorize('organizations.update'), createCustomer);
router.post('/import', authorize('organizations.update'), uploadImportCsv, importCustomers);
router.get('/export', authorize('organizations.read'), exportCustomers);
router.get('/', authorize('organizations.read'), listCustomers);
router.get('/:id', authorize('organizations.read'), getCustomerById);
router.put('/:id', authorize('organizations.update'), updateCustomer);
router.patch('/:id', authorize('organizations.update'), updateCustomer);
router.delete('/:id', authorize('organizations.update'), deleteCustomer);

module.exports = router;
