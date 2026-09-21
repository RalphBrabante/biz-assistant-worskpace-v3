const express = require('express');
const {
  listTaxTypes,
  createTaxType,
  updateTaxType,
  deleteTaxType,
} = require('../controllers/tax-types-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.get('/', authorize(['expenses.read', 'organizations.read']), listTaxTypes);
router.post('/', authorize('expenses.create'), createTaxType);
router.put('/:id', authorize('expenses.update'), updateTaxType);
router.delete('/:id', authorize('expenses.delete'), deleteTaxType);

module.exports = router;
