const express = require('express');
const {
  listWithholdingTaxTypes,
  createWithholdingTaxType,
  updateWithholdingTaxType,
  deleteWithholdingTaxType,
} = require('../controllers/withholding-tax-types-controller');
const { authorize } = require('../middleware/authz');
const { readCacheMiddleware } = require('../middleware/cache');

const router = express.Router();

router.get('/', authorize('expenses.read'), readCacheMiddleware, listWithholdingTaxTypes);
router.post('/', authorize('expenses.create'), createWithholdingTaxType);
router.put('/:id', authorize('expenses.update'), updateWithholdingTaxType);
router.delete('/:id', authorize('expenses.delete'), deleteWithholdingTaxType);

module.exports = router;
