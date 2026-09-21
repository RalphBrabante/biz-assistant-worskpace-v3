const { createStorageMigrationService, withMigrationLock } = require('../services/storage-migration-service');
const service = createStorageMigrationService();

function superuser(req, res) {
  if (!(req.auth?.roleCodes || []).some((role) => String(role).toLowerCase() === 'superuser')) {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Only superuser can migrate storage across organizations.' });
    return false;
  }
  return true;
}

function handler(action, mutates = false) {
  return async (req, res) => {
    if (!superuser(req, res)) return;
    try {
      const execute = () => action(req);
      const data = await (mutates ? withMigrationLock(execute) : execute());
      res.set('Cache-Control', 'no-store');
      res.json({ code: 'SUCCESS', data });
    } catch (error) {
      console.error('Storage migration request failed:', error.name, error.code || '');
      res.status(error.status || 500).json({ code: 'STORAGE_MIGRATION_ERROR',
        message: error.status ? error.message : 'Storage migration is unavailable. Check database migrations, Spaces configuration, and server storage permissions.' });
    }
  };
}

// Settings writes share the migration lock so another tab cannot change the source during copying.
function protectStorageChanges(original) {
  return async (req, res) => {
    if (!superuser(req, res)) return;
    try {
      await withMigrationLock(async () => {
        if (await service.active()) {
          return res.status(409).json({ code: 'STORAGE_MIGRATION_ACTIVE',
            message: 'Finish or close the current storage migration before changing storage settings.' });
        }
        await original(req, res);
      });
    } catch (error) {
      res.status(error.status || 500).json({ code: 'STORAGE_MIGRATION_ERROR',
        message: error.status ? error.message : 'Cannot update storage settings. Check that database migrations have run.' });
    }
  };
}

module.exports = {
  latest: handler(() => service.latest()),
  create: handler((req) => service.create(req.auth?.userId || null), true),
  batch: handler((req) => service.batch(req.params.id, req.auth?.userId || null), true),
  retry: handler((req) => service.retry(req.params.id), true),
  cancel: handler((req) => service.cancel(req.params.id), true),
  audit: handler((req) => service.audit(req.params.id)),
  protectStorageChanges,
};
