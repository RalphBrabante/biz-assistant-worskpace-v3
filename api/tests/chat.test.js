const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Op, Sequelize } = require('sequelize');
const { randomUUID } = require('node:crypto');
const filename = require.resolve('../src/controllers/chat-controller');
const originalRequire = createRequire(filename);
const org = '11111111-1111-4111-8111-111111111111', otherOrg = '22222222-2222-4222-8222-222222222222';
const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', carol = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function matches(row, where) {
  return Reflect.ownKeys(where).every(key => {
    const value = where[key];
    if (key === Op.or) return value.some(condition => matches(row, condition));
    if (key === Op.and) return value.every(condition => matches(row, condition));
    if (value && typeof value === 'object' && !(value instanceof Date)) return Reflect.ownKeys(value).every(op => {
      if (op === Op.ne) return row[key] !== value[op];
      if (op === Op.lt) return row[key] < value[op];
      if (op === Op.lte) return row[key] <= value[op];
      if (op === Op.gt) return row[key] > value[op];
      return false;
    });
    return row[key] instanceof Date ? row[key].getTime() === new Date(value).getTime() : row[key] === value;
  });
}
function fixture() {
  const messages = [], locks = [], queries = [], events = [];
  const members = new Map([[`${org}:${alice}`, true], [`${org}:${bob}`, true], [`${otherOrg}:${carol}`, true]]);
  const inactiveUsers = new Set();
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const models = {
    User: {},
    OrganizationUser: {
      async findOne(options) {
        const { organizationId, userId } = options.where;
        if (options.transaction) { assert.equal(options.lock, 'UPDATE'); locks.push(userId); }
        assert.equal(options.include[0].where.isActive, true);
        assert.equal(options.include[0].where.status, 'active');
        return members.get(`${organizationId}:${userId}`) && !inactiveUsers.has(userId) ? { chatUser: { id: userId, email: `${userId}@example.test` } } : null;
      },
      async findAndCountAll(options) { queries.push(options); return { count: 1, rows: [{ chatUser: { id: bob, email: 'bob@example.test' } }] }; },
    },
    ChatMessage: {
      sequelize: { transaction: async callback => callback(transaction) },
      async create(data, options) { assert.equal(options.transaction, transaction); const row = { id: randomUUID(), readAt: null, createdAt: new Date(), ...data }; messages.push(row); return row; },
      async findOne(options) {
        queries.push(options);
        const rows = messages.filter(row => matches(row, options.where));
        if (options.order) rows.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        return rows[0] || null;
      },
      async findAll(options) {
        queries.push(options);
        if (options.group) return [];
        return messages.filter(row => matches(row, options.where)).sort((a, b) =>
          (b.createdAt - a.createdAt || b.id.localeCompare(a.id)) * (options.order[0][1] === 'ASC' ? -1 : 1)).slice(0, options.limit);
      },
      async update(data, options) { queries.push(options); for (const row of messages.filter(row => matches(row, options.where))) Object.assign(row, data); },
    },
  };
  const io = { to(room) { events.push(room); return this; }, emit(name, data) { events.push({ name, data }); } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Date, Object,
    require: name => name === '../sequelize' ? { getModels: () => models } : name === '../services/socket-service' ? { getSocketServer: () => io } : originalRequire(name),
  });
  async function request(method, { userId = alice, organizationId = org, roles = ['staff'], peer = bob, query = {}, body = {}, authenticated = true } = {}) {
    const req = { auth: authenticated ? { userId, user: { organizationId }, roleCodes: roles, isPrivileged: true } : null, query, body, params: { userId: peer } };
    const res = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(data) { this.body = data; return this; } };
    await module.exports[method](req, res, error => { res.statusCode = error.status || 500; res.error = error; });
    return res;
  }
  return { request, messages, members, inactiveUsers, locks, queries, events };
}
test('all chat endpoints require authentication and active organization membership, including superusers', async () => {
  for (const method of ['users', 'presence', 'unread', 'history', 'send', 'read']) {
    const e = fixture();
    assert.equal((await e.request(method, { authenticated: false })).statusCode, 401);
    assert.equal((await e.request(method, { query: { organizationId: otherOrg } })).statusCode, 403);
    assert.equal((await e.request(method, { roles: ['superuser'], query: { organizationId: otherOrg } })).statusCode, 403);
    e.members.set(`${org}:${alice}`, false);
    assert.equal((await e.request(method)).statusCode, 403);
    assert.equal(e.messages.length, 0);
  }
});
test('members can communicate without directory permissions; foreign, inactive and self recipients fail', async () => {
  const e = fixture();
  const body = { body: 'Hello team', clientMessageId: randomUUID(), senderUserId: carol, organizationId: org };
  const sent = await e.request('send', { body });
  assert.equal(sent.statusCode, 201); assert.equal(e.messages[0].senderUserId, alice);
  assert.equal(e.messages[0].organizationId, org); assert.equal(e.messages[0].recipientUserId, bob);
  assert.equal(sent.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(e.locks, [alice, bob]);
  assert.equal((await e.request('send', { body, peer: carol })).statusCode, 403);
  assert.equal((await e.request('send', { body, peer: alice })).statusCode, 400);
  e.inactiveUsers.add(bob);
  assert.equal((await e.request('history')).statusCode, 403);
  assert.equal((await e.request('send', { body })).statusCode, 403);
});
test('retries reuse a message and reject a reused request with changed content or recipient', async () => {
  const e = fixture(), body = { body: 'One message', clientMessageId: randomUUID() };
  assert.equal((await e.request('send', { body })).statusCode, 201);
  assert.equal((await e.request('send', { body })).statusCode, 200);
  assert.equal(e.messages.length, 1);
  assert.equal((await e.request('send', { body: { ...body, body: 'Changed' } })).statusCode, 409);
  e.members.set(`${org}:${carol}`, true);
  assert.equal((await e.request('send', { body, peer: carol })).statusCode, 409);
  const event = e.events.find(item => item.name === 'chat.changed');
  assert.deepEqual(Object.keys(event.data), ['organizationId']);
  assert.ok(e.events.includes(`user:${bob}`)); assert.ok(!e.events.includes(`org:${org}`));
});
test('message validation rejects empty, oversized, non-string and invalid retry identifiers', async () => {
  const e = fixture();
  for (const body of [null, {}, { body: '   ' }, { body: 42 }, { body: 'x'.repeat(4001) }, { body: 'Hello', clientMessageId: 'invalid' }]) {
    assert.equal((await e.request('send', { body })).statusCode, 400);
  }
  assert.equal(e.messages.length, 0);
});
test('replies retain a quoted target and reject references outside the conversation or organization', async () => {
  const e = fixture();
  const original = await e.request('send', { userId: bob, peer: alice, body: { body: 'Question', clientMessageId: randomUUID() } });
  const target = original.body.data.id;
  const body = { body: 'Answer', clientMessageId: randomUUID(), replyToMessageId: target };
  const sent = await e.request('send', { body }); assert.equal(sent.statusCode, 201);
  assert.equal(sent.body.data.replyToMessageId, target); assert.equal(sent.body.data.replyTo.body, 'Question');
  assert.equal(sent.body.data.replyTo.senderUserId, bob);
  assert.equal(e.messages[1].replySenderUserId, bob); assert.equal(e.messages[1].replyRecipientUserId, alice);
  assert.ok(!Object.keys(sent.body.data).includes('replySenderUserId'));
  assert.equal((await e.request('send', { body })).statusCode, 200);
  assert.equal((await e.request('send', { body: { ...body, replyToMessageId: null } })).statusCode, 409);
  e.members.set(`${org}:${carol}`, true);
  assert.equal((await e.request('send', { peer: carol, body: { ...body, clientMessageId: randomUUID() } })).statusCode, 404);
  e.messages.push({ id: randomUUID(), organizationId: otherOrg, senderUserId: bob, recipientUserId: alice, createdAt: new Date(), body: 'Foreign' });
  assert.equal((await e.request('send', { body: { ...body, replyToMessageId: e.messages.at(-1).id } })).statusCode, 404);
  assert.equal((await e.request('send', { body: { ...body, replyToMessageId: 'invalid' } })).statusCode, 400);
});
test('history and cursors are private to the selected pair and organization, including timestamp ties', async () => {
  const e = fixture(), time = new Date('2026-10-05T01:00:00Z');
  e.members.set(`${org}:${carol}`, true);
  for (let n = 1; n <= 53; n++) e.messages.push({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, organizationId: org, senderUserId: bob, recipientUserId: alice, createdAt: time, body: String(n), readAt: null });
  const unrelated = { id: randomUUID(), organizationId: org, senderUserId: carol, recipientUserId: bob, createdAt: time, body: 'Private' };
  e.messages.push(unrelated);
  const page = await e.request('history');
  assert.equal(page.body.data.length, 50); assert.equal(page.body.meta.hasMore, true);
  assert.equal(page.body.data[0].body, '4'); assert.equal(page.body.data.at(-1).body, '53');
  const older = await e.request('history', { query: { before: page.body.meta.before } });
  assert.equal(older.body.data.length, 3); assert.equal(older.body.meta.hasMore, false);
  assert.equal((await e.request('history', { query: { before: unrelated.id } })).statusCode, 404);
  assert.equal((await e.request('history', { peer: carol })).body.data.length, 0);
  const newer = await e.request('history', { query: { after: e.messages[0].id } });
  assert.equal(newer.body.data.length, 50); assert.equal(newer.body.data[0].body, '2'); assert.equal(newer.body.meta.hasMore, true);
  const last = await e.request('history', { query: { after: newer.body.data.at(-1).id } });
  assert.equal(last.body.data.map(row => row.body).join(','), '52,53');
});
test('read acknowledgements affect only incoming messages through the displayed boundary', async () => {
  const e = fixture();
  for (const [senderUserId, recipientUserId, seconds] of [[bob, alice, 1], [bob, alice, 2], [bob, alice, 3], [alice, bob, 1], [carol, bob, 1]])
    e.messages.push({ id: randomUUID(), organizationId: org, senderUserId, recipientUserId, body: 'Hi', createdAt: new Date(2026, 9, 5, 0, 0, seconds), readAt: null });
  assert.equal((await e.request('read', { body: { throughId: e.messages[1].id } })).statusCode, 200);
  assert.ok(e.messages[0].readAt); assert.ok(e.messages[1].readAt);
  assert.equal(e.messages[2].readAt, null); assert.equal(e.messages[3].readAt, null); assert.equal(e.messages[4].readAt, null);
  assert.equal((await e.request('read', { body: { throughId: e.messages[4].id } })).statusCode, 404);
});
test('directory and unread queries filter active membership and user status without exposing credential fields', async () => {
  const e = fixture(); await e.request('users');
  assert.equal(e.queries[0].where.organizationId, org); assert.equal(e.queries[0].where.isActive, true);
  assert.ok(!e.queries[0].include[0].attributes.includes('password'));
  assert.ok(e.queries[0].include[0].attributes.includes('profileImageCdnUrl'));
  await e.request('unread'); const query = e.queries.at(-1);
  assert.equal(query.where.recipientUserId, alice); assert.equal(query.where.organizationId, org);
  assert.equal(query.include[0].include[0].where.organizationId, org);
  assert.equal(query.include[0].include[0].where.isActive, true);
});
test('notification metadata identifies only the latest incoming message regardless of read state', async () => {
  const e = fixture();
  const row = (id, senderUserId, recipientUserId, organizationId = org) => ({ id, senderUserId, recipientUserId, organizationId,
    createdAt: new Date(`2026-10-06T00:00:0${id}Z`), body: 'Private text', readAt: new Date() });
  e.messages.push(row('1', bob, alice), row('2', bob, alice), row('3', alice, bob), row('4', bob, alice, otherOrg));
  const response = await e.request('unread');
  assert.equal(response.body.data.total, 0);
  assert.equal(response.body.data.latestIncoming.id, '2');
  assert.deepEqual(Object.keys(response.body.data.latestIncoming).sort(), ['createdAt', 'id']);
  const query = e.queries.at(-1);
  assert.deepEqual(Array.from(query.attributes), ['id', 'createdAt']);
  assert.equal(query.subQuery, false);
  assert.equal(query.include[0].where.isActive, true); assert.equal(query.include[0].where.status, 'active');
  const empty = fixture(); assert.equal((await empty.request('unread')).body.data.latestIncoming, null);
});
test('model registration supports private chat associations and composite migration relationships', async () => {
  const sequelize = new Sequelize('unused', 'unused', 'unused', { dialect: 'mysql', logging: false });
  try {
    const models = require('../src/models').initModels(sequelize);
    assert.equal(models.ChatMessage.associations.sender.target, models.User);
    assert.equal(models.ChatMessage.associations.replyTo.target, models.ChatMessage);
    assert.equal(models.OrganizationUser.associations.chatUser.target, models.User);
    const constraints = [], indexes = [], sql = [];
    await require('../src/migrations/20261005000000-create-chat-messages').up({
      createTable: async () => {}, addConstraint: async (table, definition) => constraints.push(definition),
      addIndex: async (table, fields, options) => indexes.push({ fields, options }), sequelize: { query: async query => sql.push(query) },
    }, Sequelize);
    assert.equal(constraints.length, 2);
    for (const [index, participant] of ['sender', 'recipient'].entries()) {
      assert.deepEqual(constraints[index].fields, ['organization_id', `${participant}_user_id`]);
      assert.deepEqual(constraints[index].references.fields, ['organization_id', 'user_id']);
      assert.equal(constraints[index].references.table, 'organization_users'); assert.equal(constraints[index].onDelete, 'RESTRICT');
    }
    assert.ok(indexes.some(index => index.options.unique && index.fields.includes('client_message_id')));
    assert.ok(sql.some(query => query.includes('sender_user_id <> recipient_user_id')));
  } finally { await sequelize.close(); }
});

test('organization member removal retains membership history, revokes sessions and disconnects scoped sockets', async () => {
  const file = require.resolve('../src/controllers/organizations-controller');
  const reqFromFile = createRequire(file);
  const membershipUpdates = [], userUpdates = [], revoked = [], disconnected = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const member = { userId: bob, organizationId: org, isPrimary: true, isActive: true };
  const models = {
    Organization: { findByPk: async () => ({ id: org }) },
    User: { sequelize: { transaction: async callback => callback(transaction) },
      findByPk: async () => ({ id: bob, organizationId: org }), update: async change => userUpdates.push(change) },
    OrganizationUser: {
      findOne: async query => query.where.organizationId ? member : null,
      update: async (change, options) => { assert.equal(options.transaction, transaction); membershipUpdates.push(change); },
      destroy: async () => { throw new Error('Chat membership history must not be deleted'); },
    },
    Token: { findAll: async () => [org, otherOrg].map(organizationId => ({ metadata: { organizationId }, update: async change => revoked.push({ organizationId, change }) })) },
    OrganizationUserRole: { destroy: async () => {} },
  };
  const io = { in: () => ({ fetchSockets: async () => [org, otherOrg].map(organizationId => ({ data: { auth: { organizationId } }, disconnect: () => disconnected.push(organizationId) })) }) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, Date, console,
    require: name => name === '../sequelize' ? { getModels: () => models } : name === '../services/email-service' ? {} :
      name === '../services/socket-service' ? { getSocketServer: () => io } : reqFromFile(name),
  });
  const req = { params: { id: org, userId: bob }, auth: { roleCodes: ['administrator'], user: { organizationId: org } } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await module.exports.removeUserFromOrganization(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(membershipUpdates[0].isActive, false); assert.equal(membershipUpdates[0].isPrimary, false);
  assert.equal(userUpdates[0].organizationId, null);
  assert.equal(revoked.length, 1); assert.equal(revoked[0].organizationId, org); assert.equal(revoked[0].change.isActive, false);
  assert.deepEqual(disconnected, [org]);
});
