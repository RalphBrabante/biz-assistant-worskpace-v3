const { Op, fn, col } = require('sequelize');
const { getModels } = require('../sequelize');
const { getSocketServer } = require('../services/socket-service');
const { AppError } = require('../utils/app-error');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const userFields = ['id', 'firstName', 'lastName', 'email', 'profileImageUrl', 'profileImageCdnUrl'];
const messageFields = ['id', 'organizationId', 'senderUserId', 'recipientUserId', 'clientMessageId', 'body', 'readAt', 'createdAt'];
const activeUser = { isActive: true, status: 'active' };
function invalid(message) { throw new AppError('BAD_REQUEST', message, 400); }
function uuid(value, label) { if (typeof value !== 'string' || !UUID.test(value)) invalid(`${label} must be a valid UUID.`); return value.toLowerCase(); }
function conversation(scope, peerId) {
  return { organizationId: scope.organizationId, [Op.or]: [
    { senderUserId: scope.userId, recipientUserId: peerId },
    { senderUserId: peerId, recipientUserId: scope.userId },
  ] };
}
function boundary(row, inclusive = false) {
  return { [Op.or]: [ { createdAt: { [Op.lt]: row.createdAt } },
    { createdAt: row.createdAt, id: { [inclusive ? Op.lte : Op.lt]: row.id } } ] };
}
async function membership(models, organizationId, userId, transaction) {
  const row = await models.OrganizationUser.findOne({
    where: { organizationId, userId, isActive: true },
    include: [{ model: models.User, as: 'chatUser', required: true, attributes: userFields, where: activeUser }],
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!row) throw new AppError('CHAT_MEMBERSHIP_REQUIRED', 'Chat requires active users who belong to this organization.', 403);
  return row;
}
async function scopeFor(req, models) {
  if (!req.auth?.userId) throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
  const userId = uuid(req.auth.userId, 'User');
  const authOrg = req.auth.user?.organizationId;
  const superuser = (req.auth.roleCodes || []).includes('superuser');
  const suppliedOrg = req.query?.organizationId || req.body?.organizationId;
  if (!superuser && suppliedOrg && suppliedOrg !== authOrg) throw new AppError('FORBIDDEN', 'Chat is restricted to your current organization.', 403);
  const organizationId = uuid(superuser ? suppliedOrg || authOrg : authOrg, 'Organization');
  await membership(models, organizationId, userId);
  return { organizationId, userId };
}
async function peerFor(req, models, scope) {
  const peerId = uuid(req.params.userId, 'Recipient');
  if (peerId === scope.userId) invalid('Select another organization member.');
  await membership(models, scope.organizationId, peerId);
  return peerId;
}
function handler(run) {
  return async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const models = getModels();
      if (!models?.ChatMessage) throw new AppError('SERVICE_UNAVAILABLE', 'Chat is not ready. Apply the chat migration.', 503);
      const scope = await scopeFor(req, models);
      return await run(req, res, models, scope);
    } catch (error) { return next(error); }
  };
}
function notify(scope, peerId) {
  // Only invalidate participant views. Never push private content to org rooms
  // or sockets whose membership may have changed since their handshake.
  getSocketServer()?.to(`user:${scope.userId}`).to(`user:${peerId}`).emit('chat.changed', { organizationId: scope.organizationId });
}

const users = handler(async (req, res, models, scope) => {
  const page = Math.min(100000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const where = { ...activeUser };
  if (search) where[Op.or] = ['firstName', 'lastName', 'email'].map(field => ({ [field]: { [Op.like]: `%${search.replace(/[\\%_]/g, '\\$&')}%` } }));
  const result = await models.OrganizationUser.findAndCountAll({
    where: { organizationId: scope.organizationId, isActive: true, userId: { [Op.ne]: scope.userId } },
    include: [{ model: models.User, as: 'chatUser', required: true, attributes: userFields, where }],
    order: [[{ model: models.User, as: 'chatUser' }, 'firstName', 'ASC'], ['userId', 'ASC']],
    limit: 50, offset: (page - 1) * 50,
  });
  return res.json({ data: result.rows.map(row => row.chatUser), meta: { page, total: result.count, totalPages: Math.ceil(result.count / 50) } });
});
const unread = handler(async (_req, res, models, scope) => {
  const sender = { model: models.User, as: 'sender', attributes: [], required: true, where: activeUser,
    include: [{ model: models.OrganizationUser, as: 'chatMemberships', attributes: [], required: true, where: { organizationId: scope.organizationId, isActive: true } }] };
  const rows = await models.ChatMessage.findAll({
    where: { organizationId: scope.organizationId, recipientUserId: scope.userId, readAt: null },
    attributes: ['senderUserId', [fn('COUNT', col('ChatMessage.id')), 'count']],
    include: [sender],
    group: ['ChatMessage.sender_user_id'], raw: true,
  });
  const counts = Object.fromEntries(rows.map(row => [row.senderUserId, Number(row.count)]));
  // Independent of read state: an open conversation can mark a new message
  // read before the unread refresh completes, but it should still chime once.
  const latestIncoming = await models.ChatMessage.findOne({
    where: { organizationId: scope.organizationId, recipientUserId: scope.userId },
    attributes: ['id', 'createdAt'], include: [sender],
    // The organization/user unique key makes the filtered membership join
    // one-to-one. Avoid Sequelize's limit subquery around the nested joins.
    subQuery: false,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
  });
  return res.json({ data: { total: Object.values(counts).reduce((sum, n) => sum + n, 0), counts,
    latestIncoming: latestIncoming ? { id: latestIncoming.id, createdAt: latestIncoming.createdAt } : null } });
});
const history = handler(async (req, res, models, scope) => {
  const peerId = await peerFor(req, models, scope);
  const where = conversation(scope, peerId);
  const after = Boolean(req.query.after);
  if (req.query.before && after) invalid('Use only one message cursor.');
  if (req.query.before || after) {
    const cursor = await models.ChatMessage.findOne({ where: { ...where, id: uuid(req.query.before || req.query.after, 'Cursor') } });
    if (!cursor) throw new AppError('NOT_FOUND', 'Message cursor was not found in this conversation.', 404);
    where[Op.and] = [after ? { [Op.or]: [
      { createdAt: { [Op.gt]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
    ] } : boundary(cursor)];
  }
  const direction = after ? 'ASC' : 'DESC';
  const rows = await models.ChatMessage.findAll({ where, attributes: messageFields, order: [['createdAt', direction], ['id', direction]], limit: 51 });
  const hasMore = rows.length > 50;
  const page = rows.slice(0, 50);
  if (!after) page.reverse();
  const readThrough = await models.ChatMessage.findOne({
    where: { organizationId: scope.organizationId, senderUserId: scope.userId, recipientUserId: peerId, readAt: { [Op.ne]: null } },
    attributes: ['id', 'createdAt', 'readAt'], order: [['createdAt', 'DESC'], ['id', 'DESC']],
  });
  return res.json({ data: page, meta: { hasMore, before: page[0]?.id || null,
    readThrough: readThrough ? { id: readThrough.id, createdAt: readThrough.createdAt, readAt: readThrough.readAt } : null } });
});
const send = handler(async (req, res, models, scope) => {
  const peerId = uuid(req.params.userId, 'Recipient');
  if (peerId === scope.userId) invalid('Select another organization member.');
  if (typeof req.body?.body !== 'string') invalid('Enter a message.');
  const body = req.body.body.trim();
  if (!body || body.length > 4000) invalid('Messages must contain between 1 and 4,000 characters.');
  const clientMessageId = uuid(req.body.clientMessageId, 'Message request');
  let created = false;
  const row = await models.ChatMessage.sequelize.transaction(async transaction => {
    // Stable lock ordering serializes retries and protects against removal
    // between checking membership and writing the message.
    for (const id of [scope.userId, peerId].sort()) await membership(models, scope.organizationId, id, transaction);
    const existing = await models.ChatMessage.findOne({ where: { organizationId: scope.organizationId, senderUserId: scope.userId, clientMessageId }, transaction });
    if (existing) {
      if (existing.recipientUserId !== peerId || existing.body !== body) throw new AppError('CONFLICT', 'This message request was already used. Refresh before sending.', 409);
      return existing;
    }
    created = true;
    return models.ChatMessage.create({ organizationId: scope.organizationId, senderUserId: scope.userId, recipientUserId: peerId, clientMessageId, body }, { transaction });
  });
  notify(scope, peerId);
  return res.status(created ? 201 : 200).json({ data: row });
});
const read = handler(async (req, res, models, scope) => {
  const peerId = await peerFor(req, models, scope);
  const throughId = uuid(req.body?.throughId, 'Read boundary');
  const row = await models.ChatMessage.findOne({ where: { ...conversation(scope, peerId), id: throughId } });
  if (!row) throw new AppError('NOT_FOUND', 'Message was not found in this conversation.', 404);
  await models.ChatMessage.update({ readAt: new Date() }, { where: {
    organizationId: scope.organizationId, senderUserId: peerId, recipientUserId: scope.userId, readAt: null, [Op.and]: [boundary(row, true)],
  } });
  notify(scope, peerId);
  return res.json({ data: { ok: true } });
});
module.exports = { users, unread, history, send, read };
