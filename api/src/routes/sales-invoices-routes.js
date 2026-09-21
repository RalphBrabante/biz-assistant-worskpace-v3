const express = require('express');
const {
  createSalesInvoice,
  importSalesInvoices,
  exportSalesInvoices,
  listSalesInvoices,
  getSalesInvoiceById,
  updateSalesInvoice,
  deleteSalesInvoice,
} = require('../controllers/sales-invoices-controller');
const { authorize } = require('../middleware/authz');
const { uploadImportCsv } = require('../middleware/upload');

const router = express.Router();

router.post('/', authorize('sales_invoices.create'), createSalesInvoice);
router.post('/import', authorize('sales_invoices.create'), uploadImportCsv, importSalesInvoices);
router.get('/export', authorize('sales_invoices.read'), exportSalesInvoices);
router.get('/', authorize('sales_invoices.read'), listSalesInvoices);
router.get('/:id', authorize('sales_invoices.read'), getSalesInvoiceById);
router.put('/:id', authorize('sales_invoices.update'), updateSalesInvoice);
router.patch('/:id', authorize('sales_invoices.update'), updateSalesInvoice);
router.delete('/:id', authorize('sales_invoices.update'), deleteSalesInvoice);

module.exports = router;
