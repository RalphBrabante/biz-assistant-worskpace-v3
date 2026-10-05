const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { getSocketServer } = require('./socket-service');

const ACTIVE_USER = { isActive: true, status: 'active' };
const TTL = 90000;
const statuses = new Set(['online', 'away', 'silent']);
const roomFor = organizationId => `chat-org:${organizationId}`;

function registerChatPresence(socket) {
  const { userId, organizationId } = socket.data.auth || {};
  if (!userId || !organizationId) return;
  let pending = false, lastCheck = -Infinity, requestedStatus = 'online';
  const publish = () => getSocketServer()?.to(roomFor(organizationId)).emit('chat.presence.changed', { organizationId });
  const clear = () => {
    const existed = Boolean(socket.data.chatPresence);
    delete socket.data.chatPresence;
    void socket.leave(roomFor(organizationId));
    if (existed) publish();
  };
  socket.on('chat.presence', async payload => {
    if (!statuses.has(payload?.status)) return;
    requestedStatus = payload.status;
    if (pending) return;
    if (Date.now() - lastCheck < 1000) {
      // Reuse the just-verified membership for rapid status changes, while
      // limiting database reads. Presence reads recheck membership as well.
      if (socket.data.chatPresence && socket.data.chatPresence.status !== requestedStatus) {
        socket.data.chatPresence.status = requestedStatus; publish();
      }
      return;
    }
    pending = true; lastCheck = Date.now();
    try {
      const models = getModels();
      const member = models && await models.OrganizationUser.findOne({
        where: { organizationId, userId, isActive: true }, attributes: ['userId'],
        include: [{ model: models.User, as: 'chatUser', required: true, attributes: ['id'], where: ACTIVE_USER }],
      });
      if (!member || !socket.connected) { clear(); return; }
      const changed = socket.data.chatPresence?.status !== requestedStatus;
      socket.data.chatPresence = { organizationId, userId, status: requestedStatus, updatedAt: Date.now() };
      await socket.join(roomFor(organizationId));
      if (changed) publish();
    } catch { clear(); } finally { pending = false; }
  });
  socket.on('disconnect', clear);
}

async function organizationPresence(models, organizationId) {
  const io = getSocketServer();
  if (!io) return [];
  const sockets = await io.in(roomFor(organizationId)).fetchSockets();
  const now = Date.now(), live = new Map();
  const priority = { away: 1, silent: 2, online: 3 };
  for (const socket of sockets) {
    const value = socket.data.chatPresence, auth = socket.data.auth;
    if (!value || value.organizationId !== organizationId || auth?.organizationId !== organizationId ||
      value.userId !== auth?.userId || !statuses.has(value.status) || now - value.updatedAt >= TTL) continue;
    if (!live.has(value.userId) || priority[value.status] > priority[live.get(value.userId)]) live.set(value.userId, value.status);
  }
  if (!live.size) return [];
  const members = await models.OrganizationUser.findAll({
    where: { organizationId, isActive: true, userId: { [Op.in]: [...live.keys()] } }, attributes: ['userId'],
    include: [{ model: models.User, as: 'chatUser', required: true, attributes: [], where: ACTIVE_USER }],
  });
  return members.map(member => ({ userId: member.userId, status: live.get(member.userId) }));
}

module.exports = { registerChatPresence, organizationPresence };
