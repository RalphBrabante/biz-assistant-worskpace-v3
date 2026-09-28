const router=require('express').Router();
const {authorize}=require('../middleware/authz');
const {requireBankAdministrator}=require('../middleware/bank-administrator');
const c=require('../controllers/cheques-controller');
router.use(requireBankAdministrator);
router.get('/',authorize('banks.read'),c.list);
router.post('/',authorize('banks.transact'),c.create);
router.post('/:id/actions',authorize('banks.transact'),c.action);
module.exports=router;
