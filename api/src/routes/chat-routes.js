const router = require('express').Router();
const controller = require('../controllers/chat-controller');
// Chat is available to every authenticated active member, independent of
// directory-management permissions. The controller enforces membership.
router.get('/users', controller.users);
router.get('/presence', controller.presence);
router.get('/unread', controller.unread);
router.get('/users/:userId/messages', controller.history);
router.post('/users/:userId/messages', controller.send);
router.post('/users/:userId/read', controller.read);
module.exports = router;
