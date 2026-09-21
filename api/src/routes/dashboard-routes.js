const express = require('express');
const { getMonthlySummary } = require('../controllers/dashboard-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.get(
  '/monthly-summary',
  authorize(['reports.read']),
  getMonthlySummary
);

module.exports = router;
