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
const migration = require('../controllers/storage-migration-controller');

router.get('/cache', authorize('settings.update'), getCacheSetting);
router.put('/cache', authorize('settings.update'), updateCacheSetting);
router.get('/storage', authorize('settings.update'), getStorageSetting);
router.put('/storage', authorize('settings.update'), migration.protectStorageChanges(updateStorageSetting));
router.get('/storage/migrations/latest', authorize('settings.update'), migration.latest);
router.post('/storage/migrations', authorize('settings.update'), migration.create);
router.post('/storage/migrations/:id/batch', authorize('settings.update'), migration.batch);
router.post('/storage/migrations/:id/retry', authorize('settings.update'), migration.retry);
router.post('/storage/migrations/:id/cancel', authorize('settings.update'), migration.cancel);
router.get('/storage/migrations/:id/audit', authorize('settings.update'), migration.audit);
router.get('/storage/google-drive/auth-url', authorize('settings.update'), getGoogleDriveAuthUrl);
router.get('/storage/google-drive/callback', handleGoogleDriveCallback);
router.post('/storage/google-drive/disconnect', authorize('settings.update'), disconnectGoogleDrive);

module.exports = router;
