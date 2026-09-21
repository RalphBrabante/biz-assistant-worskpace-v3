'use strict';
// Opt-in integration check: uses only a newly created disposable schema and synthetic files.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Sequelize, DataTypes } = require('sequelize');

async function main() {
  const target = `storage_migration_test_${randomUUID().replace(/-/g, '')}`;
  const username = process.env.STORAGE_TEST_USER || 'root';
  const password = process.env.STORAGE_TEST_PASSWORD;
  if (!password) throw new Error('Set STORAGE_TEST_PASSWORD for a local MySQL account allowed to create disposable databases.');
  const options = { host: process.env.STORAGE_TEST_HOST || '127.0.0.1', port: Number(process.env.STORAGE_TEST_PORT || 3306), dialect: 'mysql', logging: false };
  const admin = new Sequelize('mysql', username, password, options);
  let db, directory, created = false;
  try {
    await admin.query(`CREATE DATABASE \`${target}\``); created = true;
    db = new Sequelize(target, username, password, options);
    Object.assign(process.env, { DB_HOST: options.host, DB_PORT: String(options.port), DB_NAME: target, DB_USER: username, DB_PASSWORD: password });
    const { initStorageMigrationModels, StorageMigration, StorageMigrationItem } = require('../src/models/storage-migration');
    const { createStorageMigrationService, withMigrationLock } = require('../src/services/storage-migration-service');
    const { copySpacesObject } = require('../src/services/spaces-local-copy');
    const migration = require('../src/migrations/20260921020000-add-storage-migration-audit');
    const id = { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 };
    const opts = { underscored: true };
    const Expense = db.define('Expense', { id, organizationId: DataTypes.UUID,
      file: DataTypes.STRING(1000), fileCdnUrl: DataTypes.STRING(1000), receiptUrl: DataTypes.STRING(1000),
      amount: DataTypes.DECIMAL(12, 2), taxAmount: DataTypes.DECIMAL(12, 2), totalAmount: DataTypes.DECIMAL(12, 2) }, { ...opts, tableName: 'expenses' });
    const User = db.define('User', { id, profileImageUrl: DataTypes.STRING(1000), profileImageCdnUrl: DataTypes.STRING(1000) }, { ...opts, tableName: 'users' });
    const AppSetting = db.define('AppSetting', { id, key: { type: DataTypes.STRING(120), unique: true }, valueText: DataTypes.TEXT, updatedBy: DataTypes.UUID }, opts);
    await User.sync(); await Expense.sync(); await AppSetting.sync();
    await migration.up(db.getQueryInterface(), Sequelize);
    initStorageMigrationModels(db);
    const models = { Expense, User, AppSetting, StorageMigration, StorageMigrationItem };
    const actor = await User.create({});
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-migration-integration-'));
    const doSpaces = { endpoint: 'https://sgp1.digitaloceanspaces.com', region: 'sgp1', bucket: 'test-bucket',
      accessKey: 'fake-key', secretKey: 'fake-secret', cdnBaseUrl: '' };
    const config = async () => ({ isDoSpacesConfigured: true, doSpaces, provider: 'do_spaces',
      uploadTargets: { expenseAttachment: 'do_spaces', profileImage: 'do_spaces' } });
    const base = 'https://test-bucket.sgp1.digitaloceanspaces.com/';
    const synthetic = Buffer.from('%PDF synthetic receipt');
    let missing = true, copyHook;
    const downloads = [];
    const clientFactory = () => ({ send: async (command) => {
      const key = command.input.Key; downloads.push(key);
      if (key === 'missing.pdf' && missing) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: Readable.from([synthetic]), ContentLength: synthetic.length, ContentType: 'application/pdf' };
    } });
    const service = createStorageMigrationService({ models: () => models, config, directory: () => directory, clientFactory,
      clearCache: async () => {}, copy: async (input) => {
        const result = await copySpacesObject(input);
        if (copyHook) { const hook = copyHook; copyHook = undefined; await hook(); }
        return result;
      } });
    const expense = await Expense.create({ organizationId: randomUUID(), file: `${base}receipt.pdf`, fileCdnUrl: `${base}receipt.pdf`,
      receiptUrl: `${base}receipt.pdf`, amount: '5888.18', taxAmount: '0.00', totalAmount: '5888.18' });
    const failed = await Expense.create({ organizationId: randomUUID(), file: `${base}missing.pdf`, amount: '112.00', taxAmount: '12.00', totalAmount: '112.00' });
    const profile = await User.create({ profileImageUrl: `${base}profile.png`, profileImageCdnUrl: `${base}profile.png` });
    await expense.reload(); // Compare persisted precision (MySQL DATETIME has no milliseconds).
    const original = expense.toJSON();
    const job = await service.create(actor.id);
    assert.equal(job.counts.total, 3); assert.equal(job.counts.expenses, 2); assert.equal(job.counts.profiles, 1);
    assert.equal((await AppSetting.count()), 0, 'preview must not switch providers');
    assert.equal((await service.create(actor.id)).id, job.id, 'duplicate requests reuse the active job');
    const late = await Expense.create({ file: `${base}late.pdf` });
    // Resume through new service instances, just as after a process restart.
    let result = job;
    for (let i = 0; i < 20 && result.status !== 'needs_attention'; i++) result = await service.batch(job.id, actor.id);
    assert.equal(result.status, 'needs_attention'); assert.equal(result.counts.completed, 3); assert.equal(result.counts.failed, 1);
    assert.equal(await AppSetting.count({ where: { valueText: 'local' } }), 3);
    await expense.reload(); await failed.reload(); await profile.reload(); await late.reload();
    for (const field of ['amount', 'taxAmount', 'totalAmount', 'organizationId']) assert.equal(expense[field], original[field]);
    assert.equal(expense.updatedAt.getTime(), original.updatedAt.getTime(), 'historical timestamp preserved');
    assert.match(expense.file, /^\/uploads\/migrated\//); assert.equal(expense.file, expense.fileCdnUrl); assert.equal(expense.file, expense.receiptUrl);
    assert.equal(failed.file, `${base}missing.pdf`); assert.match(profile.profileImageUrl, /^\/uploads\//); assert.match(late.file, /^\/uploads\//);
    assert.equal(downloads.filter((key) => key === 'receipt.pdf').length, 1, 'duplicate fields copied once');
    missing = false;
    await service.retry(job.id);
    const resumed = createStorageMigrationService({ models: () => models, config, directory: () => directory, clientFactory, clearCache: async () => {} });
    for (let i = 0; i < 10 && result.status !== 'completed'; i++) result = await resumed.batch(job.id, actor.id);
    assert.equal(result.status, 'completed'); assert.equal(result.counts.failed, 0);
    const audit = await service.audit(job.id);
    assert.equal(audit.items.length, 4); assert.equal(audit.items.every((item) => item.after && item.verification), true);
    assert.equal(JSON.stringify(audit).includes('fake-secret'), false);
    assert.equal(JSON.stringify(audit).includes('fake-key'), false);

    const changed = await Expense.create({ file: `${base}Old.pdf` });
    const second = await service.create(actor.id);
    copyHook = () => changed.update({ file: `${base}old.pdf` });
    result = await service.batch(second.id, actor.id);
    await changed.reload(); assert.equal(changed.file, `${base}old.pdf`, 'case-only concurrent edit preserved');
    assert.equal(result.counts.skipped, 1);
    for (let i = 0; i < 10 && result.status !== 'completed'; i++) result = await service.batch(second.id, actor.id);
    assert.equal(result.status, 'completed'); assert.equal(result.counts.completed, 1);

    const rollback = await Expense.create({ file: `${base}atomic.pdf`, amount: '123.45' });
    const atomic = await service.create(actor.id);
    const originalUpdate = StorageMigrationItem.prototype.update;
    StorageMigrationItem.prototype.update = async function(values, options) {
      if (values.status === 'completed') throw Object.assign(new Error('Synthetic audit write failure'), { code: 'TEST_AUDIT_FAILURE' });
      return originalUpdate.call(this, values, options);
    };
    try { await service.batch(atomic.id, actor.id); }
    finally { StorageMigrationItem.prototype.update = originalUpdate; }
    await rollback.reload(); assert.equal(rollback.file, `${base}atomic.pdf`, 'audit failure rolls back link updates');
    result = await service.retry(atomic.id);
    for (let i = 0; i < 10 && result.status !== 'completed'; i++) result = await service.batch(atomic.id, actor.id);
    assert.equal(result.status, 'completed');

    await Expense.create({ file: 'https://other-bucket.sgp1.digitaloceanspaces.com/a.pdf' });
    const third = await service.create(actor.id);
    assert.equal(third.counts.failed, 1, 'unrecognized Spaces bucket must be reported');
    const oldBucket = doSpaces.bucket; doSpaces.bucket = 'changed';
    await assert.rejects(service.batch(third.id, actor.id), /source or local upload directory changed/);
    doSpaces.bucket = oldBucket;
    assert.equal((await service.cancel(third.id)).status, 'cancelled');
    await assert.rejects(service.batch(third.id, actor.id), /closed/);
    await withMigrationLock(async () => {
      await assert.rejects(withMigrationLock(async () => {}), /Another storage operation/);
    });
    await withMigrationLock(async () => {});
    await migration.down(db.getQueryInterface());
    await migration.up(db.getQueryInterface(), Sequelize);
    assert.equal(await Expense.count(), 6, 'schema up/down leaves business records intact');
    console.log('PASS: preview, all organizations, verified copies, safe failures/retry, resume, final rescan, concurrent edits, audit, provider switch, schema up/down, and cross-connection lock. No existing business data or Spaces objects accessed.');
  } finally {
    if (db) await db.close();
    if (created) await admin.query(`DROP DATABASE \`${target}\``);
    await admin.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
