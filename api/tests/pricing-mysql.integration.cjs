/** Opt-in: creates and drops a NEW isolated schema/user on the local Docker MySQL. */
const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'), crypto = require('node:crypto');
require('ts-node').register({ transpileOnly: true, project: require('node:path').join(__dirname, '../tsconfig.json') });
const { Sequelize } = require('sequelize');
const migration = require('../src/migrations/20261005030000-create-pricing-requests');
const { initPricingRequestModels, PricingRequest, PricingRequestLimit } = require('../src/models/pricing-request');
const database = require('../src/sequelize');
database.getModels = () => ({ PricingRequest, PricingRequestLimit });
const { PricingRepository } = require('../src/modules/pricing/pricing.repository');
const { PricingService } = require('../src/modules/pricing/pricing.service');

test('MySQL migration, private persistence, unique duplicate arbitration, idempotency and atomic multi-instance rate limits', { skip: process.env.RUN_PRICING_MYSQL_INTEGRATION !== '1' }, async () => {
  const suffix = crypto.randomBytes(6).toString('hex'), schema = `pricing_test_${suffix}`, username = `pricing_${suffix}`, password = crypto.randomBytes(24).toString('hex');
  const container = process.env.PRICING_TEST_MYSQL_CONTAINER || 'biz-assitant-mysql';
  if (!/^[a-zA-Z0-9_-]+$/.test(container)) throw new Error('Invalid local test container name.');
  const admin = sql => execFileSync('docker', ['exec', '-i', container, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  admin(`CREATE DATABASE ${schema}; CREATE USER '${username}'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON ${schema}.* TO '${username}'@'%';`);
  const connection = new Sequelize(schema, username, password, { host: '127.0.0.1', port: 3306, dialect: 'mysql', logging: false, pool: { max: 10, min: 0 } });
  try {
    await connection.authenticate(); await migration.up(connection.getQueryInterface(), Sequelize); initPricingRequestModels(connection);
    const repository = new PricingRepository(), replica = new PricingRepository();
    process.env.PRICING_REQUEST_HASH_SECRET = 'synthetic-integration-secret-longer-than-32-characters';
    const service = new PricingService(repository), now = Date.now();
    const body = { name: 'Synthetic Buyer', email: 'synthetic@example.test', planId: 'silver', cycle: 'monthly', capacity: { organizations: 7, users: 8, storageGB: 25, mailboxes: 3 }, website: '', challenge: service.catalogue(now - 3000).requestChallenge, requestKey: crypto.randomUUID(), subtotalMinor: 1 };
    const received = await service.submit(body, 'synthetic-ip', now);
    const persisted = await PricingRequest.findByPk(received.data.id);
    assert.equal(persisted.selectionSnapshot.estimate.subtotalMinor, 559400); assert.equal(persisted.catalogueVersion, '2026-10-launch-proposal-v1');
    const retry = await service.submit(body, 'synthetic-ip', now); assert.equal(retry.data.id, received.data.id); assert.equal(await PricingRequest.count(), 1);
    const double = await service.submit({ ...body, requestKey: crypto.randomUUID() }, 'synthetic-ip', now); assert.equal(double.data.id, received.data.id); assert.equal(await PricingRequest.count(), 1);
    // Direct repository concurrency isolates duplicate arbitration from abuse limits.
    const values = { ...persisted.get({ plain: true }) }; delete values.id; delete values.createdAt; delete values.updatedAt;
    const results = await Promise.all(Array.from({ length: 6 }, () => replica.save(values))); assert.ok(results.every(row => row.id === persisted.id));
    await assert.rejects(() => replica.save({ ...values, payloadHash: 'a'.repeat(64), dedupeHash: 'b'.repeat(64) }), error => error.getStatus() === 409);
    const key = crypto.randomBytes(32).toString('hex');
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, n) => (n % 2 ? repository : replica).consumeLimit(key, 5, new Date(Date.now() + 3600000))));
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 5);
    assert.ok(attempts.filter(r => r.status === 'rejected').every(r => r.reason.getStatus() === 429));
    assert.equal((await PricingRequestLimit.findByPk(key)).attempts, 5);
    const list = await repository.list(1); assert.equal(list.count, 1); assert.equal(list.rows[0].requestKeyHash, undefined); assert.equal(list.rows[0].payloadHash, undefined);
    await migration.down(connection.getQueryInterface());
    assert.equal((await connection.getQueryInterface().showAllTables()).length, 0);
  } finally {
    await connection.close(); admin(`DROP DATABASE IF EXISTS ${schema}; DROP USER IF EXISTS '${username}'@'%';`);
  }
});
