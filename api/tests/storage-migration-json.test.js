const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Sequelize } = require('sequelize');
const { initStorageMigrationModels, StorageMigration, StorageMigrationItem } = require('../src/models/storage-migration');
const { createStorageMigrationService } = require('../src/services/storage-migration-service');

// Hydrate the same values returned by mysql2 for MariaDB JSON/LONGTEXT columns.
const db = new Sequelize('test', 'test', 'test', { dialect: 'mysql', logging: false });
initStorageMigrationModels(db);
const source = { endpoint: 'https://sgp1.digitaloceanspaces.com', region: 'sgp1', bucket: 'receipts', cdnBaseUrl: '' };
const before = { file: 'https://receipts.sgp1.digitaloceanspaces.com/a.pdf', fileCdnUrl: null, receiptUrl: null };

function fixture(asText = true) {
  const encode = (value) => asText ? JSON.stringify(value) : value;
  const job = StorageMigration.build({ id: 'job', status: 'ready', source: encode(source), destination: '/persistent/uploads',
    previousProviders: encode({ provider: 'do_spaces' }), switchedAt: null }, { isNewRecord: false, raw: true });
  job.update = async (values) => { job.set(values); return job; };
  const item = StorageMigrationItem.build({ id: 'item', entityType: 'Expense', entityId: 'expense',
    before: encode(before), objects: encode({ file: 'a.pdf' }), after: null, verification: null }, { isNewRecord: false, raw: true });
  const models = {
    StorageMigration: { findByPk: async () => job },
    StorageMigrationItem: { update: async () => {}, findAll: async (options) => {
      if (options.group || options.attributes) return [];
      return options.raw ? [item.get({ plain: true, raw: true })] : [item];
    } },
    Expense: { findAll: async () => [] }, User: { findAll: async () => [] },
  };
  const current = { ...source };
  let destination = job.destination;
  const service = createStorageMigrationService({ models: () => models,
    config: async () => ({ isDoSpacesConfigured: true, doSpaces: current }),
    directory: () => destination, clearCache: async () => {} });
  return { job, item, models, service, current, setDirectory: (value) => { destination = value; } };
}

for (const asText of [true, false]) {
  test(`unchanged migration resumes with ${asText ? 'MariaDB text' : 'MySQL object'} JSON`, async () => {
    const { service, job } = fixture(asText);
    const result = await service.retry(job.id);
    assert.equal(result.bucket, source.bucket);
    assert.equal(result.status, 'ready');
    assert.deepEqual(job.source, { ...source, otherExternalLinks: 0 });
  });
}

test('real source and destination changes still stop migration', async () => {
  for (const key of Object.keys(source)) {
    const { service, job, current } = fixture();
    current[key] = { endpoint: 'https://nyc3.digitaloceanspaces.com', region: 'nyc3', bucket: 'other', cdnBaseUrl: 'https://cdn.example.com' }[key];
    await assert.rejects(service.retry(job.id), /source or local upload directory changed/);
  }
  const { service, job, setDirectory } = fixture();
  setDirectory('/different/uploads');
  await assert.rejects(service.retry(job.id), /source or local upload directory changed/);
});

test('loaded item snapshots, copies and audit serialize as objects', async () => {
  const { service, job, item } = fixture();
  assert.deepEqual(item.before, before);
  assert.deepEqual(item.objects, { file: 'a.pdf' });
  assert.equal(item.after, null);
  assert.equal(item.verification, null);
  item.setDataValue('after', JSON.stringify({ ...before, file: '/uploads/a.pdf' }));
  item.setDataValue('verification', JSON.stringify({ 'a.pdf': { bytes: 12, sha256: 'digest' } }));
  const audit = await service.audit(job.id);
  assert.deepEqual(audit.source, source);
  assert.deepEqual(audit.previousProviders, { provider: 'do_spaces' });
  assert.deepEqual(audit.items[0].before, before);
  assert.equal(audit.items[0].after.file, '/uploads/a.pdf');
  assert.equal(audit.items[0].verification['a.pdf'].bytes, 12);
});

test('invalid saved JSON fails instead of silently replacing the scan', () => {
  const { job } = fixture();
  for (const value of ['invalid JSON', '[]', 'null', '"text"']) {
    job.setDataValue('source', value);
    assert.throws(() => job.source);
  }
});

test('first batch copies a persisted text snapshot and updates links and audit', async () => {
  const { job, item, models } = fixture();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-json-'));
  try {
    job.destination = directory;
    const providers = [];
    const copied = [];
    const record = { ...before };
    const transaction = async (action) => action({ LOCK: { UPDATE: 'UPDATE' } });
    models.StorageMigration.sequelize = { transaction };
    models.AppSetting = { upsert: async (setting) => providers.push(setting.valueText) };
    models.StorageMigrationItem.findOne = async () => item;
    item.update = async (values) => { item.set(values); return item; };
    models.Expense.findByPk = async () => ({ ...record });
    models.Expense.sequelize = { transaction };
    models.Expense.update = async (values) => Object.assign(record, values);
    const service = createStorageMigrationService({ models: () => models,
      config: async () => ({ isDoSpacesConfigured: true, doSpaces: source }),
      directory: () => directory, clearCache: async () => {}, clientFactory: () => ({}),
      copy: async (input) => {
        copied.push({ bucket: input.source.bucket, key: input.key, directory: input.directory });
        return { url: '/uploads/migrated/a.pdf', sha256: 'digest', bytes: 12 };
      } });
    await service.batch(job.id, null);
    assert.deepEqual(providers, ['local', 'local', 'local']);
    assert.deepEqual(copied, [{ bucket: source.bucket, key: 'a.pdf', directory }]);
    assert.equal(record.file, '/uploads/migrated/a.pdf');
    assert.equal(item.status, 'completed');
    assert.equal(item.after.file, record.file);
    assert.equal(item.verification['a.pdf'].sha256, 'digest');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
