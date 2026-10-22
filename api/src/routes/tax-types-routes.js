const express = require('express');
const {
  listTaxTypes,
  createTaxType,
  updateTaxType,
  deleteTaxType,
} = require('../controllers/tax-types-controller');
const { authorize } = require('../middleware/authz');
const { requireGlobalRoleAdministrator } = require('../services/role-access');
const { readCacheMiddleware } = require('../middleware/cache');

const router = express.Router();

router.get('/', authorize(['expenses.read', 'organizations.read']), readCacheMiddleware, listTaxTypes);
router.post('/', requireGlobalRoleAdministrator, authorize('expenses.create'), createTaxType);
router.put('/:id', requireGlobalRoleAdministrator, authorize('expenses.update'), updateTaxType);
router.delete('/:id', requireGlobalRoleAdministrator, authorize('expenses.delete'), deleteTaxType);

module.exports = router;
