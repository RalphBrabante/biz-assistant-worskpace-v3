const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Op } = require('sequelize');

function fixture() {
  let now = 100000, allowed = true;
  const events = [], queries = [], sockets = [], members = new Set(['alice', 'bob']);
  const models = { User: {}, OrganizationUser: {
    async findOne(query) { queries.push(query); return allowed ? { userId: 'alice' } : null; },
    async findAll(query) { queries.push(query); return query.where.userId[Op.in].filter(id => members.has(id)).map(userId => ({ userId })); },
  } };
  const io = { to: room => ({ emit: (name, data) => events.push({ room, name, data }) }),
    in: room => { assert.equal(room, 'chat-org:org-a'); return { fetchSockets: async () => sockets }; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/chat-presence'), 'utf8'), {
    module, exports: module.exports, Date: class extends Date { static now() { return now; } },
    require: name => name === '../sequelize' ? { getModels: () => models } : name === './socket-service' ? { getSocketServer: () => io } : require(name),
  });
  function socket(userId = 'alice', organizationId = 'org-a') {
    const handlers = new Map(), rooms = new Set();
    const value = { data: { auth: { userId, organizationId } }, connected: true,
      on: (name, fn) => handlers.set(name, fn), join: async room => rooms.add(room), leave: async room => rooms.delete(room),
      event: (name, payload) => handlers.get(name)?.(payload), rooms };
    sockets.push(value); module.exports.registerChatPresence(value); return value;
  }
  return { ...module.exports, models, socket, sockets, events, queries, members, advance: ms => { now += ms; }, deny: () => { allowed = false; } };
}

test('presence derives identity from authenticated sockets and revalidates active membership on heartbeats', async () => {
  const e = fixture(), socket = e.socket();
  await socket.event('chat.presence', { status: 'online', userId: 'bob', organizationId: 'org-b' });
  assert.equal(socket.data.chatPresence.userId, 'alice'); assert.equal(socket.data.chatPresence.organizationId, 'org-a');
  assert.ok(socket.rooms.has('chat-org:org-a'));
  const query = e.queries[0]; assert.equal(query.where.isActive, true); assert.equal(query.where.organizationId, 'org-a');
  assert.equal(query.include[0].where.status, 'active');
  const event = e.events[0]; assert.equal(event.name, 'chat.presence.changed');
  assert.deepEqual(Object.keys(event.data), ['organizationId']);
  e.advance(1000); e.deny(); await socket.event('chat.presence', { status: 'silent' });
  assert.equal(socket.data.chatPresence, undefined); assert.equal(socket.rooms.size, 0);
});
test('presence rejects invalid statuses and throttles requests without disrupting sockets', async () => {
  const e = fixture(), socket = e.socket();
  await socket.event('chat.presence', { status: 'invalid' }); assert.equal(e.queries.length, 0);
  await socket.event('chat.presence', { status: 'online' });
  await socket.event('chat.presence', { status: 'away' }); assert.equal(e.queries.length, 1);
  assert.equal(socket.data.chatPresence.status, 'away');
  e.advance(1000); await socket.event('chat.presence', { status: 'away' }); assert.equal(socket.data.chatPresence.status, 'away');
  socket.connected = false; await socket.event('disconnect'); assert.equal(socket.data.chatPresence, undefined);
});
test('presence aggregates multiple tabs and excludes expired, foreign and removed organization members', async () => {
  const e = fixture(), first = e.socket(), second = e.socket(), bob = e.socket('bob');
  await first.event('chat.presence', { status: 'away' });
  await second.event('chat.presence', { status: 'online' });
  await bob.event('chat.presence', { status: 'silent' });
  const foreign = e.socket('bob', 'org-b'); await foreign.event('chat.presence', { status: 'online' });
  let rows = await e.organizationPresence(e.models, 'org-a');
  assert.equal(rows.map(row => row.status).join(','), 'online,silent');
  second.connected = false; await second.event('disconnect');
  rows = await e.organizationPresence(e.models, 'org-a'); assert.equal(rows[0].status, 'away');
  e.members.delete('bob'); rows = await e.organizationPresence(e.models, 'org-a'); assert.equal(rows.length, 1);
  assert.equal(e.queries.at(-1).include[0].where.isActive, true);
  e.advance(90000); assert.equal((await e.organizationPresence(e.models, 'org-a')).length, 0);
});
