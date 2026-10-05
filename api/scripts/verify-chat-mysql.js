// Run only against a new disposable database, never the application's database.
const { Sequelize } = require('sequelize');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function main() {
  const database = process.env.CHAT_VERIFY_DATABASE || '';
  if (!/^chat_verify_[a-f0-9]{32}$/.test(database)) throw new Error('CHAT_VERIFY_DATABASE must be a new disposable database named chat_verify_<32 hex characters>.');
  const sequelize = new Sequelize(database, process.env.CHAT_VERIFY_USER, process.env.CHAT_VERIFY_PASSWORD, {
    host: process.env.CHAT_VERIFY_HOST || '127.0.0.1', port: Number(process.env.CHAT_VERIFY_PORT || 3306), dialect: 'mysql', logging: false,
  });
  try {
    await sequelize.authenticate();
    const [tables] = await sequelize.query('SHOW TABLES');
    assert.equal(tables.length, 0, 'Verification requires an empty disposable database.');
    await sequelize.query('CREATE TABLE organizations (id CHAR(36) BINARY PRIMARY KEY)');
    await sequelize.query(`CREATE TABLE users (id CHAR(36) BINARY PRIMARY KEY, first_name VARCHAR(100), last_name VARCHAR(100),
      email VARCHAR(255), profile_image_url TEXT, profile_image_cdn_url TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, status VARCHAR(50) NOT NULL DEFAULT 'active')`);
    await sequelize.query(`CREATE TABLE organization_users (id CHAR(36) BINARY PRIMARY KEY, organization_id CHAR(36) BINARY NOT NULL,
      user_id CHAR(36) BINARY NOT NULL, role VARCHAR(50) NOT NULL DEFAULT 'member', is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY membership (organization_id,user_id), FOREIGN KEY (organization_id) REFERENCES organizations(id), FOREIGN KEY (user_id) REFERENCES users(id))`);
    await require('../src/migrations/20261005000000-create-chat-messages').up(sequelize.getQueryInterface(), Sequelize);
    const models = require('../src/models').initModels(sequelize);
    const org = randomUUID(), otherOrg = randomUUID(), alice = randomUUID(), bob = randomUUID(), carol = randomUUID();
    await sequelize.query('INSERT INTO organizations VALUES (?),(?)', { replacements: [org, otherOrg] });
    for (const [id, name, organizationId] of [[alice, 'Alice', org], [bob, 'Bob', org], [carol, 'Carol', otherOrg]]) {
      await sequelize.query('INSERT INTO users (id,first_name,email) VALUES (?,?,?)', { replacements: [id, name, `${name.toLowerCase()}@example.test`] });
      await sequelize.query('INSERT INTO organization_users (id,organization_id,user_id) VALUES (?,?,?)', { replacements: [randomUUID(), organizationId, id] });
    }
    const filename = require.resolve('../src/controllers/chat-controller');
    const originalRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Date, Object,
      require: name => name === '../sequelize' ? { getModels: () => models } : name === '../services/socket-service' ? { getSocketServer: () => null } : originalRequire(name),
    });
    async function request(method, { actor = alice, peer = bob, body = {}, query = {}, roles = ['staff'] } = {}) {
      const req = { auth: { userId: actor, user: { organizationId: org }, roleCodes: roles }, params: { userId: peer }, body, query };
      const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
      await module.exports[method](req, res, error => { if (!error.status) throw error; res.statusCode = error.status; });
      return res;
    }
    const directory = await request('users', { query: { search: 'Bob' } });
    assert.equal(directory.body.data.length, 1); assert.equal(directory.body.data[0].id, bob);
    const body = { body: 'Hello 👋', clientMessageId: randomUUID() };
    const simultaneous = await Promise.all([request('send', { body }), request('send', { body })]);
    assert.equal(simultaneous.filter(res => res.statusCode === 201).length, 1);
    assert.equal(await models.ChatMessage.count(), 1, 'Concurrent retries must create one message.');
    const bobUnread = (await request('unread', { actor: bob })).body.data;
    assert.equal(bobUnread.counts[alice], 1);
    assert.equal(bobUnread.latestIncoming.id, simultaneous[0].body.data.id);
    assert.deepEqual(Object.keys(bobUnread.latestIncoming).sort(), ['createdAt', 'id']);
    assert.equal((await request('unread')).body.data.latestIncoming, null, 'Outgoing messages must not trigger sounds.');
    const incoming = await request('history', { actor: bob, peer: alice });
    assert.equal(incoming.body.data[0].body, 'Hello 👋');
    await request('read', { actor: bob, peer: alice, body: { throughId: incoming.body.data[0].id } });
    const bobRead = (await request('unread', { actor: bob })).body.data;
    assert.equal(bobRead.total, 0); assert.equal(bobRead.latestIncoming.id, bobUnread.latestIncoming.id);
    assert.ok((await request('history')).body.meta.readThrough);
    await models.ChatMessage.bulkCreate(Array.from({ length: 60 }, (_, index) => ({
      organizationId: org, senderUserId: bob, recipientUserId: alice,
      clientMessageId: randomUUID(), body: `Message ${index}`, createdAt: new Date('2100-01-01T00:00:00.123Z'),
    })));
    const recent = await request('history');
    assert.equal((await request('unread')).body.data.latestIncoming.id, recent.body.data.at(-1).id);
    assert.equal(recent.body.data.length, 50); assert.equal(recent.body.meta.hasMore, true);
    const older = await request('history', { query: { before: recent.body.meta.before } });
    assert.equal(older.body.data.length, 11);
    assert.equal(new Set([...recent.body.data, ...older.body.data].map(row => row.id)).size, 61);
    const newer = await request('history', { query: { after: older.body.data[0].id } });
    assert.equal(newer.body.data.length, 50); assert.equal(newer.body.meta.hasMore, true);
    const remaining = await request('history', { query: { after: newer.body.data[49].id } });
    assert.equal(remaining.body.data.length, 10);
    assert.equal((await request('history', { peer: carol })).statusCode, 403);
    assert.equal((await request('history', { roles: ['superuser'], query: { organizationId: otherOrg } })).statusCode, 403);
    await assert.rejects(models.ChatMessage.create({ organizationId: org, senderUserId: alice, recipientUserId: carol, clientMessageId: randomUUID(), body: 'Foreign member' }), { name: 'SequelizeForeignKeyConstraintError' });
    await models.OrganizationUser.update({ isActive: false }, { where: { organizationId: org, userId: bob } });
    assert.equal((await request('unread')).body.data.latestIncoming, null, 'Inactive senders must not trigger sounds.');
    assert.equal((await request('history')).statusCode, 403);
    assert.equal((await request('send', { body: { body: 'Blocked', clientMessageId: randomUUID() } })).statusCode, 403);
    assert.equal(await models.ChatMessage.count(), 61, 'Removal must preserve chat history.');
    console.log('MySQL chat verification passed: member search, persistent messages, concurrent retries, unread counts, read receipts, cursor pagination, isolation and membership removal.');
  } finally { await sequelize.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
