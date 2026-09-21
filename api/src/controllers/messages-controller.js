const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { applyOrganizationWhereScope } = require('../services/request-scope');

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
}

function getMessageModels() {
  const models = getModels();
  if (!models || !models.Message || !models.Organization || !models.User) {
    return null;
  }
  return {
    Message: models.Message,
    Organization: models.Organization,
    User: models.User,
  };
}

async function getUnreadMessageCount(req, res) {
  try {
    const models = getMessageModels();
    if (!models) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Message } = models;
    const where = {
      isRead: false,
    };

    if (req.query.organizationId) {
      where.organizationId = req.query.organizationId;
    }
    if (!applyOrganizationWhereScope(where, req)) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId is required for this user.' });
    }

    const unreadCount = await Message.count({ where });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Unread message count fetched successfully.',
      data: {
        unreadCount,
      },
    });
  } catch (err) {
    console.error('Get unread message count error:', err);
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to fetch unread message count.' });
  }
}

async function listMessages(req, res) {
  try {
    const models = getMessageModels();
    if (!models) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Message, Organization, User } = models;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const offset = (page - 1) * limit;
    const where = {};

    if (req.query.organizationId) {
      where.organizationId = req.query.organizationId;
    }
    if (!applyOrganizationWhereScope(where, req)) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId is required for this user.' });
    }

    if (req.query.entityType) {
      where.entityType = String(req.query.entityType).trim();
    }
    const isRead = parseBoolean(req.query.isRead);
    if (isRead !== undefined) {
      where.isRead = isRead;
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      where[Op.or] = [
        { title: { [Op.like]: `%${q}%` } },
        { message: { [Op.like]: `%${q}%` } },
      ];
    }

    const { rows, count } = await Message.findAndCountAll({
      where,
      include: [
        {
          model: Organization,
          as: 'organization',
          attributes: ['id', 'name', 'legalName'],
          required: false,
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'firstName', 'lastName', 'email'],
          required: false,
        },
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    });

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Messages fetched successfully.',
      data: rows,
      meta: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('List messages error:', err);
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to fetch messages.' });
  }
}

async function markMessageRead(req, res) {
  try {
    const models = getMessageModels();
    if (!models) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Message } = models;
    const where = { id: req.params.id };
    if (!applyOrganizationWhereScope(where, req)) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Message not found.' });
    }

    const message = await Message.findOne({ where });
    if (!message) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Message not found.' });
    }

    if (!message.isRead) {
      await message.update({
        isRead: true,
        readAt: new Date(),
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Message marked as read.',
      data: message,
    });
  } catch (err) {
    console.error('Mark message read error:', err);
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to mark message as read.' });
  }
}

async function markAllMessagesRead(req, res) {
  try {
    const models = getMessageModels();
    if (!models) {
      return res.status(503).json({ code: 'SERVICE_UNAVAILABLE', message: 'Database models are not ready yet.' });
    }

    const { Message } = models;
    const where = { isRead: false };

    if (req.query.organizationId) {
      where.organizationId = req.query.organizationId;
    }
    if (!applyOrganizationWhereScope(where, req)) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'organizationId is required for this user.' });
    }

    const [updatedCount] = await Message.update(
      { isRead: true, readAt: new Date() },
      { where }
    );

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'All messages marked as read.',
      data: { updatedCount },
    });
  } catch (err) {
    console.error('Mark all messages read error:', err);
    return res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to mark all messages as read.' });
  }
}

module.exports = {
  getUnreadMessageCount,
  listMessages,
  markMessageRead,
  markAllMessagesRead,
};

