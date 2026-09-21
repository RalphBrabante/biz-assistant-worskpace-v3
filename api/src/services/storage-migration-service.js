const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { Op, fn, col } = require('sequelize');
const { S3Client } = require('@aws-sdk/client-s3');
const { getModels, initSequelize } = require('../sequelize');
const { getStorageConfig, STORAGE_KEYS } = require('./storage-service');
const { getUploadDirectory } = require('./upload-paths');
const { clearAllApiCache } = require('./cache-service');
const { sourceIdentity, resolveSpacesKey, copySpacesObject, hash } = require('./spaces-local-copy');

const REFERENCES = { Expense: ['file', 'fileCdnUrl', 'receiptUrl'], User: ['profileImageUrl', 'profileImageCdnUrl'] };
const ACTIVE = ['ready', 'running', 'needs_attention'];
function fail(message, status = 409) { const error = new Error(message); error.status = status; throw error; }

// A dedicated connection keeps the advisory lock across short DB transactions and file I/O.
// This also works when the application pool is configured with only one connection.
async function withMigrationLock(action) {
  const config = initSequelize().config;
  const connection = await mysql.createConnection({ ...config.dialectOptions, host: config.host,
    port: config.port, user: config.username, password: config.password, database: config.database });
  const name = `storage-migration:${hash(config.database).slice(0, 32)}`;
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [name]);
    if (Number(rows[0].acquired) !== 1) fail('Another storage operation is running. Please try again shortly.');
    return await action();
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    await connection.end();
  }
}

function createStorageMigrationService({ models = getModels, config = getStorageConfig,
  directory = getUploadDirectory, copy = copySpacesObject,
  clientFactory = (source, credentials) => new S3Client({ endpoint: source.endpoint,
    region: source.region, credentials, forcePathStyle: false, maxAttempts: 1 }),
  clearCache = clearAllApiCache } = {}) {
  const getJob = async (id) => {
    const job = await models().StorageMigration.findByPk(id);
    if (!job) fail('Migration not found.', 404);
    return job;
  };
  const active = () => models().StorageMigration.findOne({ where: { status: ACTIVE }, order: [['createdAt', 'DESC']] });
  const invalidate = async () => { await clearCache().catch(() => console.warn('Storage migration: cache invalidation failed; cached links will expire.')); };
  async function checkConfiguration(job) {
    const current = await config();
    if (!current.isDoSpacesConfigured) fail('Save complete DigitalOcean Spaces credentials in Settings first.', 400);
    const identity = sourceIdentity(current.doSpaces);
    if (Object.keys(identity).some((key) => identity[key] !== job.source[key]) || directory() !== job.destination) {
      fail('The source or local upload directory changed. Close this migration and scan again.');
    }
    return current;
  }

  async function scan(job) {
    const { StorageMigrationItem } = models();
    let otherExternalLinks = 0;
    for (const [entityType, fields] of Object.entries(REFERENCES)) {
      let cursor;
      for (;;) {
        const rows = await models()[entityType].findAll({ attributes: ['id', ...fields],
          where: cursor ? { id: { [Op.gt]: cursor } } : {}, order: [['id', 'ASC']], limit: 500, raw: true });
        const entries = [];
        for (const row of rows) {
          const before = Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
          const objects = {};
          let unresolved = false;
          for (const field of fields) {
            const value = before[field];
            const key = resolveSpacesKey(value, job.source);
            if (key) objects[field] = key;
            else if (/^https?:\/\//i.test(value || '')) {
              const host = (() => { try { return new URL(value).hostname; } catch { return ''; } })();
              if (host.endsWith('.digitaloceanspaces.com')) { objects[field] = null; unresolved = true; }
              else otherExternalLinks += 1;
            }
          }
          if (!Object.keys(objects).length) continue;
          const referenceHash = hash(JSON.stringify({ entityType, id: row.id, before }));
          entries.push({ migrationId: job.id, referenceHash, entityType, entityId: row.id, before, objects,
            status: unresolved ? 'failed' : 'pending',
            error: unresolved ? 'A Spaces URL does not match the configured bucket. Correct its source configuration or record link, then scan again.' : null });
        }
        if (entries.length) await StorageMigrationItem.bulkCreate(entries, { ignoreDuplicates: true });
        if (rows.length < 500) break;
        cursor = rows[rows.length - 1].id;
      }
    }
    await job.update({ source: { ...job.source, otherExternalLinks } });
  }

  async function summary(job) {
    if (!job) return null;
    const groups = await models().StorageMigrationItem.findAll({ where: { migrationId: job.id },
      attributes: ['status', 'entityType', [fn('COUNT', col('id')), 'count']], group: ['status', 'entityType'], raw: true });
    const counts = { pending: 0, completed: 0, failed: 0, skipped: 0, total: 0, expenses: 0, profiles: 0 };
    for (const row of groups) {
      const count = Number(row.count); counts[row.status] += count; counts.total += count;
      counts[row.entityType === 'Expense' ? 'expenses' : 'profiles'] += count;
    }
    const issues = await models().StorageMigrationItem.findAll({ where: { migrationId: job.id, status: 'failed' },
      attributes: ['id', 'entityType', 'entityId', 'error'], order: [['createdAt', 'ASC']], limit: 20, raw: true });
    return { id: job.id, status: job.status, bucket: job.source.bucket, switchedAt: job.switchedAt,
      createdAt: job.createdAt, counts, issues, otherExternalLinks: job.source.otherExternalLinks || 0 };
  }

  async function create(actor) {
    const existing = await active();
    if (existing) return summary(existing);
    const current = await config();
    if (!current.isDoSpacesConfigured) fail('Save complete DigitalOcean Spaces credentials in Settings first.', 400);
    const source = sourceIdentity(current.doSpaces);
    const job = await models().StorageMigration.create({ source, destination: directory(),
      previousProviders: { provider: current.provider, ...current.uploadTargets }, createdBy: actor });
    await scan(job);
    return summary(job);
  }

  async function start(job, actor) {
    await checkConfiguration(job);
    await fs.mkdir(job.destination, { recursive: true });
    const probe = path.join(job.destination, `.migration-write-check-${crypto.randomUUID()}`);
    await fs.writeFile(probe, 'storage migration', { flag: 'wx', mode: 0o600 });
    await fs.unlink(probe);
    await models().StorageMigration.sequelize.transaction(async (transaction) => {
      for (const key of [STORAGE_KEYS.provider, STORAGE_KEYS.expenseAttachmentProvider, STORAGE_KEYS.profileImageProvider]) {
        await models().AppSetting.upsert({ key, valueText: 'local', updatedBy: actor }, { transaction });
      }
      await job.update({ status: 'running', switchedAt: new Date() }, { transaction });
    });
    await invalidate();
  }

  async function processItem(item, job, client) {
    const Model = models()[item.entityType];
    const fields = REFERENCES[item.entityType];
    const current = await Model.findByPk(item.entityId, { attributes: ['id', ...fields], raw: true });
    if (!current || fields.some((field) => (current[field] ?? null) !== item.before[field])) {
      await item.update({ status: 'skipped', error: 'The record was changed or deleted after scanning. Current links are checked in the final scan.' });
      return;
    }
    const verification = {};
    const after = { ...item.before };
    try {
      // One shared deadline bounds this record even when it refers to several different objects.
      const signal = AbortSignal.timeout(20000);
      for (const [field, key] of Object.entries(item.objects)) {
        if (!key) throw new Error('The Spaces URL does not match the configured bucket.');
        if (!verification[key]) verification[key] = await copy({ client, source: job.source, key,
          directory: job.destination, signal });
        after[field] = verification[key].url;
      }
      await Model.sequelize.transaction(async (transaction) => {
        // Lock and compare in JS as MySQL URL columns may use a case-insensitive collation.
        const locked = await Model.findByPk(item.entityId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!locked || fields.some((field) => (locked[field] ?? null) !== item.before[field])) {
          await item.update({ status: 'skipped', verification, error: 'The record changed during copying. Its links were left untouched.' }, { transaction });
          return;
        }
        await Model.update(after, { where: { id: item.entityId }, transaction, silent: true, hooks: false });
        await item.update({ status: 'completed', after, verification, error: null }, { transaction });
      });
    } catch (error) {
      const known = { NoSuchKey: 'The file was not found in Spaces.', AccessDenied: 'Spaces denied access to this file.',
        ENOSPC: 'The server has no free disk space.', EACCES: 'The server cannot write to its upload folder.',
        AbortError: 'The copy timed out. Retry this record.', TimeoutError: 'The copy timed out. Retry this record.' };
      const message = known[error.code] || known[error.name]
        || (error.name === 'Error' && !error.code ? error.message : 'Copy or database update failed. Check server access and retry.');
      await item.update({ status: 'failed', verification, error: message.slice(0, 500) });
    }
  }

  async function batch(id, actor) {
    const job = await getJob(id);
    if (!ACTIVE.includes(job.status)) fail('This migration is closed. Create a new scan.');
    const current = await checkConfiguration(job);
    if (!job.switchedAt) await start(job, actor);
    const item = await models().StorageMigrationItem.findOne({ where: { migrationId: id, status: 'pending' }, order: [['id', 'ASC']] });
    if (item) {
      const client = clientFactory(job.source, { accessKeyId: current.doSpaces.accessKey, secretAccessKey: current.doSpaces.secretKey });
      try { await processItem(item, job, client); } finally { client.destroy?.(); }
      await invalidate();
    } else {
      await scan(job);
      // Reconcile failures whose records were corrected or deleted since the last attempt.
      const failures = await models().StorageMigrationItem.findAll({ where: { migrationId: id, status: 'failed' } });
      for (const failure of failures) {
        const row = await models()[failure.entityType].findByPk(failure.entityId);
        if (!row || REFERENCES[failure.entityType].some((field) => (row[field] ?? null) !== failure.before[field])) {
          await failure.update({ status: 'skipped', error: 'The record was changed or deleted. See the subsequent scan for its current links.' });
        }
      }
      const result = await summary(job);
      await job.update({ status: result.counts.pending ? 'running' : result.counts.failed ? 'needs_attention' : 'completed' });
    }
    return summary(job);
  }

  async function retry(id) {
    const job = await getJob(id);
    if (!ACTIVE.includes(job.status)) fail('This migration is closed.');
    await checkConfiguration(job);
    await models().StorageMigrationItem.update({ status: 'pending', error: null }, { where: { migrationId: id, status: 'failed' } });
    await scan(job);
    await job.update({ status: job.switchedAt ? 'running' : 'ready' });
    return summary(job);
  }

  async function cancel(id) {
    const job = await getJob(id);
    if (!ACTIVE.includes(job.status)) fail('This migration is already closed.');
    await job.update({ status: 'cancelled' });
    return summary(job);
  }

  return { active, create, batch, retry, cancel, summary,
    latest: async () => summary(await models().StorageMigration.findOne({ order: [['createdAt', 'DESC']] })),
    audit: async (id) => {
      const job = await getJob(id);
      const items = await models().StorageMigrationItem.findAll({ where: { migrationId: id }, order: [['createdAt', 'ASC']] });
      return { ...(await summary(job)), source: job.source, previousProviders: job.previousProviders, createdBy: job.createdBy,
        items: items.map((item) => item.toJSON()) };
    } };
}

module.exports = { createStorageMigrationService, withMigrationLock, REFERENCES, ACTIVE };
