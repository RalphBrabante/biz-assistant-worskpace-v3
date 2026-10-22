const express = require('express');
const {
  inspectDevCache,
} = require('../controllers/dev-controller');
const { requireGlobalRoleAdministrator } = require('../services/role-access');

const router = express.Router();

router.get('/cache', requireGlobalRoleAdministrator, inspectDevCache);

module.exports = router;
