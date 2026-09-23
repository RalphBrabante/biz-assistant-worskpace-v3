const express = require('express');
const { getMonthlySummary } = require('../controllers/dashboard-controller');
const { getActionCenter } = require('../controllers/action-center-controller');
const { authorize } = require('../middleware/authz');
const { readCacheMiddleware } = require('../middleware/cache');

const router = express.Router();

router.get('/action-center', authorize('dashboard.read'), getActionCenter);

router.get(
  '/monthly-summary',
  authorize(['reports.read']),
  readCacheMiddleware,
  getMonthlySummary
);

module.exports = router;
