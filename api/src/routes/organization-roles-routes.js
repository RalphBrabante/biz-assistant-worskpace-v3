const router=require('express').Router();const c=require('../controllers/organization-roles-controller');
router.get('/',c.list);router.get('/options',c.options);router.post('/',c.create);router.put('/:id',c.update);router.delete('/:id',c.remove);
router.post('/:id/permissions',c.grant);router.delete('/:id/permissions/:permissionId',c.revoke);router.post('/:id/members',c.assign);router.delete('/:id/members/:userId',c.unassign);
module.exports=router;
