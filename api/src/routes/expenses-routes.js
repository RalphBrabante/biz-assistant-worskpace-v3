const express = require('express');
const {
  createExpense,
  getExpenseTaxContext,
  importExpenses,
  exportExpenses,
  listTransferTargetOrganizations,
  listExpenses,
  getExpenseById,
  previewExpenseTransfer,
  transferExpense,
  updateExpense,
  deleteExpense,
} = require('../controllers/expenses-controller');
const { authorize } = require('../middleware/authz');
const { readCacheMiddleware } = require('../middleware/cache');
const { uploadExpenseImage, uploadImportCsv } = require('../middleware/upload');

const router = express.Router();

router.post('/', authorize('expenses.create'), uploadExpenseImage, createExpense);
router.post('/import', authorize('expenses.create'), uploadImportCsv, importExpenses);
router.get('/export', authorize('expenses.read'), exportExpenses);
router.get('/transfer-targets', authorize('expenses.update'), listTransferTargetOrganizations);
router.get('/', authorize('expenses.read'), readCacheMiddleware, listExpenses);
router.get('/tax-context', authorize(['expenses.read', 'expenses.create', 'expenses.update']), readCacheMiddleware, getExpenseTaxContext);
router.get('/:id', authorize('expenses.read'), readCacheMiddleware, getExpenseById);
router.get('/:id/transfer-preview', authorize('expenses.update'), previewExpenseTransfer);
router.post('/:id/transfer', authorize('expenses.update'), transferExpense);
router.put('/:id', authorize('expenses.update'), uploadExpenseImage, updateExpense);
router.patch('/:id', authorize('expenses.update'), uploadExpenseImage, updateExpense);
router.delete('/:id', authorize('expenses.update'), deleteExpense);

module.exports = router;
