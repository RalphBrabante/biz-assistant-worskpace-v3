const express = require('express');
const {
  inspectDevCache,
} = require('../controllers/dev-controller');

const router = express.Router();

router.get('/cache', inspectDevCache);

module.exports = router;
