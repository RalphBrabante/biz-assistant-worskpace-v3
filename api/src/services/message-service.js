const { getModels } = require('../sequelize');
const { getSocketServer } = require('./socket-service');

function getActorDisplayName(actor, fallback = 'A user') {
  const firstName = String(actor?.firstName || '').trim();
  const lastName = String(actor?.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }
  if (firstName) {
    return firstName;
  }
  const email = String(actor?.email || '').trim();
  if (email) {
    return email;
  }
  return fallback;
}

async function createOrganizationMessage({
  organizationId,
  entityType,
  entityId = null,
  title,
  message,
  createdBy = null,
  metadata = null,
  transaction = undefined,
}) {
  try {
    const models = getModels();
    if (!models?.Message) {
      return null;
    }
    if (!organizationId || !entityType || !title || !message) {
      return null;
    }

    const created = await models.Message.create(
      {
        organizationId,
        entityType,
        entityId,
        title,
        message,
        createdBy: createdBy || null,
        metadata: metadata || null,
      },
      transaction ? { transaction } : undefined
    );

    const io = getSocketServer();
    if (io) {
      const actorUserId = String(created.createdBy || '').trim();
      const orgRoom = `org:${organizationId}`;
      const emitTarget = actorUserId
        ? io.to(orgRoom).except(`user:${actorUserId}`)
        : io.to(orgRoom);

      emitTarget.emit('message.created', {
        id: created.id,
        organizationId: created.organizationId,
        entityType: created.entityType,
        entityId: created.entityId,
        title: created.title,
        message: created.message,
        metadata: created.metadata || null,
        isRead: created.isRead,
        readAt: created.readAt || null,
        createdBy: created.createdBy || null,
        createdAt: created.createdAt,
      });
    }

    return created;
  } catch (err) {
    console.error('Create organization message error:', err);
    return null;
  }
}

module.exports = {
  createOrganizationMessage,
  getActorDisplayName,
};
