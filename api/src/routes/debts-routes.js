const router = require('express').Router();
const {authorize} = require('../middleware/authz');
const c = require('../controllers/debts-controller');
router.get('/', authorize('debts.read'), c.list);
router.post('/', authorize('debts.create'), c.create);
router.get('/:id', authorize('debts.read'), c.detail);
router.post('/:id/payments', authorize('debts.pay'), c.pay);
module.exports = router;
