const express = require('express');
const { authorize } = require('../middleware/authz');
const {
  getUnreadMessageCount,
  listMessages,
  markMessageRead,
  markAllMessagesRead,
} = require('../controllers/messages-controller');

const router = express.Router();

router.get('/unread-count', authorize([]), getUnreadMessageCount);
router.get('/', authorize([]), listMessages);
router.put('/read-all', authorize([]), markAllMessagesRead);
router.put('/:id/read', authorize([]), markMessageRead);
router.patch('/:id/read', authorize([]), markMessageRead);

module.exports = router;
