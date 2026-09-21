const express = require('express');
const {
  computeQuarterlySalesInvoiceReport,
  listQuarterlySalesReports,
  getQuarterlySalesReportById,
  getQuarterlySalesReportPreviewById,
  deleteQuarterlySalesReport,
  computeQuarterlyExpenseReport,
  listQuarterlyExpenseReports,
  getQuarterlyExpenseReportById,
  getQuarterlyExpenseReportPreviewById,
  deleteQuarterlyExpenseReport,
  getBirFilingSummary,
} = require('../controllers/reports-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.post('/quarterly-sales', authorize('reports.generate'), computeQuarterlySalesInvoiceReport);
router.get('/quarterly-sales', authorize('reports.read'), listQuarterlySalesReports);
router.get('/quarterly-sales/:id', authorize('reports.read'), getQuarterlySalesReportById);
router.get('/quarterly-sales/:id/preview', authorize('reports.read'), getQuarterlySalesReportPreviewById);
router.delete('/quarterly-sales/:id', authorize('reports.delete'), deleteQuarterlySalesReport);
router.post('/quarterly-expenses', authorize('reports.generate'), computeQuarterlyExpenseReport);
router.get('/quarterly-expenses', authorize('reports.read'), listQuarterlyExpenseReports);
router.get('/quarterly-expenses/:id', authorize('reports.read'), getQuarterlyExpenseReportById);
router.get('/quarterly-expenses/:id/preview', authorize('reports.read'), getQuarterlyExpenseReportPreviewById);
router.delete('/quarterly-expenses/:id', authorize('reports.delete'), deleteQuarterlyExpenseReport);
router.get('/bir-filing-summary', authorize('reports.read'), getBirFilingSummary);

module.exports = router;
