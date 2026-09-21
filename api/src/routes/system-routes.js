const express = require('express');
const { health, root } = require('../controllers/system-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.get('/health', authorize(['reports.read', 'organizations.read', 'profile.manage']), health);
router.get('/', authorize(['reports.read', 'organizations.read', 'profile.manage']), root);

module.exports = router;
