const router=require('express').Router();
const {authorize}=require('../middleware/authz');
const {requireBankAdministrator}=require('../middleware/bank-administrator');
const c=require('../controllers/vouchers-controller');
router.use(requireBankAdministrator);
router.get('/',authorize('banks.read'),c.list);
router.post('/',authorize('banks.transact'),c.create);
router.post('/:id/void',authorize('banks.transact'),c.voidVoucher);
module.exports=router;
