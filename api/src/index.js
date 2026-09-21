const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Op } = require('sequelize');
const Redis = require('ioredis');
const amqp = require('amqplib');
const { Server } = require('socket.io');
const { authenticateSequelize } = require('./sequelize');
const authRoutes = require('./routes/auth-routes');
const systemRoutes = require('./routes/system-routes');
const itemsRoutes = require('./routes/items-routes');
const organizationsRoutes = require('./routes/organizations-routes');
const ordersRoutes = require('./routes/orders-routes');
const usersRoutes = require('./routes/users-routes');
const rolesRoutes = require('./routes/roles-routes');
const permissionsRoutes = require('./routes/permissions-routes');
const licensesRoutes = require('./routes/licenses-routes');
const salesInvoicesRoutes = require('./routes/sales-invoices-routes');
const customersRoutes = require('./routes/customers-routes');
const expensesRoutes = require('./routes/expenses-routes');
const vendorsRoutes = require('./routes/vendors-routes');
const reportsRoutes = require('./routes/reports-routes');
const settingsRoutes = require('./routes/settings-routes');
const taxTypesRoutes = require('./routes/tax-types-routes');
const withholdingTaxTypesRoutes = require('./routes/withholding-tax-types-routes');
const profileRoutes = require('./routes/profile-routes');
const messagesRoutes = require('./routes/messages-routes');
const dashboardRoutes = require('./routes/dashboard-routes');
const devRoutes = require('./routes/dev-routes');
const { authenticateRequest } = require('./middleware/authz');
const { requestLogger } = require('./middleware/request-logger');
const {
  readCacheMiddleware,
  invalidateCacheOnWriteMiddleware,
} = require('./middleware/cache');
const {
  setRedisClient,
  initializeCacheConfig,
} = require('./services/cache-service');
const { setSocketServer } = require('./services/socket-service');
const {
  startLicenseExpiryJob,
  stopLicenseExpiryJob,
} = require('./jobs/license-expiry-job');
const { getModels } = require('./sequelize');
const {
  errorResponseShapeMiddleware,
  notFoundHandler,
  errorHandler,
} = require('./middleware/error-handler');

const app = express();
const port = process.env.PORT || 3000;
const httpServer = http.createServer(app);

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use('/uploads', express.static(require('./services/upload-paths').getUploadDirectory()));
app.use(errorResponseShapeMiddleware);
app.use(requestLogger);

let sequelize;
let redisClient;
let amqpConn;

const status = {
  mysql: false,
  redis: false,
  amqp: false,
};

app.locals.serviceStatus = status;

function hasSuperuserRole(roleCodes = []) {
  const normalized = roleCodes.map((code) => String(code || '').toLowerCase());
  return normalized.includes('superuser');
}

async function resolveEffectiveOrganizationId(models, user) {
  if (!models?.OrganizationUser || !user?.id) {
    return user?.organizationId || null;
  }

  const primaryMembership = await models.OrganizationUser.findOne({
    where: {
      userId: user.id,
      isActive: true,
      isPrimary: true,
    },
    attributes: ['organizationId'],
    order: [['updatedAt', 'DESC']],
  });
  if (primaryMembership?.organizationId) {
    return primaryMembership.organizationId;
  }

  if (user.organizationId) {
    return user.organizationId;
  }

  const fallbackMembership = await models.OrganizationUser.findOne({
    where: {
      userId: user.id,
      isActive: true,
    },
    attributes: ['organizationId'],
    order: [['createdAt', 'ASC']],
  });
  return fallbackMembership?.organizationId || null;
}

const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: true,
    credentials: false,
  },
  transports: ['websocket', 'polling'],
});

io.use(async (socket, next) => {
  try {
    const models = getModels();
    if (!models || !models.Token || !models.User || !models.Role || !models.Permission || !models.License) {
      return next(new Error('Authentication service is not ready.'));
    }

    const authToken = String(socket.handshake.auth?.token || '').trim();
    const headerToken = String(socket.handshake.headers?.authorization || '').trim();
    const bearerToken = headerToken.toLowerCase().startsWith('bearer ')
      ? headerToken.slice(7).trim()
      : '';
    const rawToken = authToken || bearerToken;
    if (!rawToken) {
      return next(new Error('Missing bearer token.'));
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenRecord = await models.Token.findOne({
      where: {
        tokenHash,
        isActive: true,
        revokedAt: null,
      },
      include: [
        {
          model: models.User,
          as: 'user',
          include: [
            {
              model: models.Role,
              as: 'roles',
              through: { attributes: [] },
              include: [
                {
                  model: models.Permission,
                  as: 'permissions',
                  through: { attributes: [] },
                },
              ],
            },
          ],
        },
      ],
    });

    if (!tokenRecord) {
      return next(new Error('Invalid access token.'));
    }

    if (new Date(tokenRecord.expiresAt) <= new Date()) {
      await tokenRecord.destroy();
      return next(new Error('Access token has expired.'));
    }

    const user = tokenRecord.user;
    if (!user || !user.isActive) {
      return next(new Error('User is inactive or unavailable.'));
    }

    const roleCodes = (user.roles || []).map((role) => String(role.code || '').toLowerCase());
    const isSuperuser = hasSuperuserRole(roleCodes);
    const effectiveOrganizationId = await resolveEffectiveOrganizationId(models, user);

    if (!isSuperuser) {
      if (!effectiveOrganizationId) {
        return next(new Error('Organization has no active license.'));
      }

      const now = new Date();
      const activeLicense = await models.License.findOne({
        where: {
          organizationId: effectiveOrganizationId,
          isActive: true,
          status: 'active',
          revokedAt: null,
          expiresAt: { [Op.gte]: now },
        },
        order: [['expiresAt', 'DESC']],
      });
      if (!activeLicense) {
        return next(new Error('Organization license is missing, revoked, or expired.'));
      }
    }

    const requestedOrganizationId = String(socket.handshake.auth?.organizationId || '').trim();
    const socketOrganizationId =
      isSuperuser && requestedOrganizationId
        ? requestedOrganizationId
        : effectiveOrganizationId || null;

    socket.data.auth = {
      userId: user.id,
      roleCodes,
      organizationId: socketOrganizationId,
      isSuperuser,
    };

    return next();
  } catch (err) {
    return next(err);
  }
});

io.on('connection', (socket) => {
  const userId = String(socket.data?.auth?.userId || '').trim();
  const organizationId = String(socket.data?.auth?.organizationId || '').trim();

  if (userId) {
    socket.join(`user:${userId}`);
  }
  if (organizationId) {
    socket.join(`org:${organizationId}`);
  }
});

setSocketServer(io);

async function connectMysql() {
  sequelize = await authenticateSequelize();
  status.mysql = true;
}

async function connectMysqlWithRetry(maxAttempts = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await connectMysql();
      return;
    } catch (err) {
      const lastAttempt = attempt === maxAttempts;
      console.error(
        `MySQL connection failed (attempt ${attempt}/${maxAttempts}):`,
        err.message
      );
      if (lastAttempt) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function connectRedis() {
  redisClient = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
    maxRetriesPerRequest: 1,
    enableAutoPipelining: true,
    lazyConnect: false,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
  await redisClient.ping();
  setRedisClient(redisClient);
  status.redis = true;
}

async function connectAmqp() {
  amqpConn = await amqp.connect(
    process.env.AMQP_URL || 'amqp://guest:guest@amqp:5672'
  );
  status.amqp = true;
}

app.use('/api/v1/auth', authRoutes);
if (process.env.NODE_ENV !== 'production' && process.env.APP_ENV !== 'staging') {
  app.use('/api/v1/dev', devRoutes);
}
app.use('/api/v1', authenticateRequest);
app.use('/api/v1', readCacheMiddleware);
app.use('/api/v1', invalidateCacheOnWriteMiddleware);
app.use('/api/v1/items', itemsRoutes);
app.use('/api/v1/organizations', organizationsRoutes);
app.use('/api/v1/orders', ordersRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/roles', rolesRoutes);
app.use('/api/v1/permissions', permissionsRoutes);
app.use('/api/v1/licenses', licensesRoutes);
app.use('/api/v1/sales-invoices', salesInvoicesRoutes);
app.use('/api/v1/customers', customersRoutes);
app.use('/api/v1/expenses', expensesRoutes);
app.use('/api/v1/vendors', vendorsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/tax-types', taxTypesRoutes);
app.use('/api/v1/withholding-tax-types', withholdingTaxTypesRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/messages', messagesRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1', systemRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

async function bootstrap() {
  try {
    await connectMysqlWithRetry();
    await initializeCacheConfig();
    console.log('MySQL connected');
  } catch (err) {
    console.error('MySQL connection failed after retries:', err.message);
    process.exit(1);
  }

  try {
    await connectRedis();
    console.log('Redis connected');
  } catch (err) {
    console.error('Redis connection failed:', err.message);
    setRedisClient(null);
  }

  try {
    await connectAmqp();
    console.log('AMQP connected');
  } catch (err) {
    console.error('AMQP connection failed:', err.message);
  }

  startLicenseExpiryJob();

  // Conservative HTTP timeout tuning for low-resource hosts (1 vCPU).
  const server = httpServer.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
  server.keepAliveTimeout = Number(process.env.HTTP_KEEPALIVE_TIMEOUT_MS || 5000);
  server.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 6000);
  server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 30000);
}

process.on('SIGINT', async () => {
  try {
    stopLicenseExpiryJob();
    if (sequelize) {
      await sequelize.close();
    }
    if (redisClient) {
      await redisClient.quit();
    }
    if (amqpConn) {
      await amqpConn.close();
    }
  } finally {
    process.exit(0);
  }
});

bootstrap();
