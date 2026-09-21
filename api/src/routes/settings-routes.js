const express = require('express');
const { authorize } = require('../middleware/authz');
const {
  getCacheSetting,
  updateCacheSetting,
  getStorageSetting,
  updateStorageSetting,
  getGoogleDriveAuthUrl,
  handleGoogleDriveCallback,
  disconnectGoogleDrive,
} = require('../controllers/settings-controller');

const router = express.Router();

router.get('/cache', authorize('settings.update'), getCacheSetting);
router.put('/cache', authorize('settings.update'), updateCacheSetting);
router.get('/storage', authorize('settings.update'), getStorageSetting);
router.put('/storage', authorize('settings.update'), updateStorageSetting);
router.get('/storage/google-drive/auth-url', authorize('settings.update'), getGoogleDriveAuthUrl);
router.get('/storage/google-drive/callback', handleGoogleDriveCallback);
router.post('/storage/google-drive/disconnect', authorize('settings.update'), disconnectGoogleDrive);

module.exports = router;
