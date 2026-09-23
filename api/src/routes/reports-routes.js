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
const { readCacheMiddleware } = require('../middleware/cache');

const router = express.Router();

router.post('/quarterly-sales', authorize('reports.generate'), computeQuarterlySalesInvoiceReport);
router.get('/quarterly-sales', authorize('reports.read'), readCacheMiddleware, listQuarterlySalesReports);
router.get('/quarterly-sales/:id', authorize('reports.read'), readCacheMiddleware, getQuarterlySalesReportById);
router.get('/quarterly-sales/:id/preview', authorize('reports.read'), readCacheMiddleware, getQuarterlySalesReportPreviewById);
router.delete('/quarterly-sales/:id', authorize('reports.delete'), deleteQuarterlySalesReport);
router.post('/quarterly-expenses', authorize('reports.generate'), computeQuarterlyExpenseReport);
router.get('/quarterly-expenses', authorize('reports.read'), readCacheMiddleware, listQuarterlyExpenseReports);
router.get('/quarterly-expenses/:id', authorize('reports.read'), readCacheMiddleware, getQuarterlyExpenseReportById);
router.get('/quarterly-expenses/:id/preview', authorize('reports.read'), readCacheMiddleware, getQuarterlyExpenseReportPreviewById);
router.delete('/quarterly-expenses/:id', authorize('reports.delete'), deleteQuarterlyExpenseReport);
router.get('/bir-filing-summary', authorize('reports.read'), readCacheMiddleware, getBirFilingSummary);

module.exports = router;
