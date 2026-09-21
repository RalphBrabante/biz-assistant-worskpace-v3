import { Injectable } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Server as HttpServer } from 'http';
import * as crypto from 'crypto';
import * as express from 'express';
import { Op } from 'sequelize';
import Redis from 'ioredis';
import amqp from 'amqplib';
import { Server } from 'socket.io';

const { authenticateSequelize } = require('../../../sequelize');
const { getModels } = require('../../../sequelize');
const { setRedisClient, initializeCacheConfig } = require('../../../services/cache-service');
const { setSocketServer } = require('../../../services/socket-service');
const { startLicenseExpiryJob, stopLicenseExpiryJob } = require('../../../jobs/license-expiry-job');

const { getUploadDirectory } = require('../../../services/upload-paths');
const { installFrontend } = require('../../../middleware/frontend');
const { serviceEnabled, servicesHealthy } = require('../../../services/runtime-services');

const { requestLogger } = require('../../../middleware/request-logger');
const { errorResponseShapeMiddleware } = require('../../../middleware/error-handler');

@Injectable()
export class LegacyApiService {
  private sequelize: any;
  private redisClient: Redis | null = null;
  private amqpConn: any = null;
  private io: Server | null = null;
  private readonly status: { mysql: boolean; redis: boolean | 'disabled'; amqp: boolean | 'disabled' } = {
    mysql: false,
    redis: false,
    amqp: false,
  };

  setup(app: INestApplication): void {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.locals.serviceStatus = this.status;
    expressApp.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
    expressApp.use('/uploads', express.static(getUploadDirectory()));
    expressApp.use(requestLogger);
    expressApp.get('/healthz', async (_req: any, res: any) => {
      try {
        if (!this.sequelize) throw new Error('Database is not ready.');
        await this.sequelize.authenticate();
        this.status.mysql = true;
      } catch {
        this.status.mysql = false;
      }
      const ok = servicesHealthy(this.status);
      res.set('Cache-Control', 'no-store').status(ok ? 200 : 503).json({ ok });
    });
    expressApp.use(errorResponseShapeMiddleware);
    installFrontend(expressApp, process.env.CLIENT_DIST_DIR);
  }

  async initializeInfrastructure(httpServer: HttpServer): Promise<void> {
    this.setupSocket(httpServer);
    await this.connectMysqlWithRetry();
    await initializeCacheConfig();
    await this.connectRedis();
    await this.connectAmqp();
    if (process.env.LICENSE_EXPIRY_JOB_ENABLED !== 'false') startLicenseExpiryJob();
  }

  async shutdown(): Promise<void> {
    stopLicenseExpiryJob();
    if (this.io) {
      await this.io.close();
      this.io = null;
    }
    if (this.sequelize) {
      await this.sequelize.close();
      this.sequelize = null;
    }
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
    if (this.amqpConn) {
      await this.amqpConn.close();
      this.amqpConn = null;
    }
  }

  private hasSuperuserRole(roleCodes: string[] = []): boolean {
    const normalized = roleCodes.map((code) => String(code || '').toLowerCase());
    return normalized.includes('superuser');
  }

  private async resolveEffectiveOrganizationId(models: any, user: any): Promise<string | null> {
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

  private setupSocket(httpServer: HttpServer): void {
    this.io = new Server(httpServer, {
      path: '/socket.io',
      cors: {
        origin: true,
        credentials: false,
      },
      transports: ['websocket', 'polling'],
    });

    this.io.use(async (socket, next) => {
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

        const roleCodes = (user.roles || []).map((role: any) => String(role.code || '').toLowerCase());
        const isSuperuser = this.hasSuperuserRole(roleCodes);
        const effectiveOrganizationId = await this.resolveEffectiveOrganizationId(models, user);

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
        return next(err as Error);
      }
    });

    this.io.on('connection', (socket) => {
      const userId = String(socket.data?.auth?.userId || '').trim();
      const organizationId = String(socket.data?.auth?.organizationId || '').trim();

      if (userId) {
        socket.join(`user:${userId}`);
      }
      if (organizationId) {
        socket.join(`org:${organizationId}`);
      }
    });

    setSocketServer(this.io);
  }

  private async connectMysql(): Promise<void> {
    this.sequelize = await authenticateSequelize();
    this.status.mysql = true;
  }

  private async connectMysqlWithRetry(maxAttempts = 10, delayMs = 3000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.connectMysql();
        return;
      } catch (err: any) {
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

  private async connectRedis(): Promise<void> {
    if (!serviceEnabled('REDIS')) {
      this.status.redis = 'disabled';
      setRedisClient(null);
      return;
    }
    try {
      this.redisClient = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
        maxRetriesPerRequest: 1,
        enableAutoPipelining: true,
        lazyConnect: false,
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000),
        retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
      });
      this.redisClient.on('error', () => { this.status.redis = false; });
      this.redisClient.on('ready', () => { this.status.redis = true; });
      await this.redisClient.ping();
      setRedisClient(this.redisClient);
      this.status.redis = true;
      console.log('Redis connected');
    } catch (err: any) {
      console.error('Redis connection failed:', err.message);
      setRedisClient(null);
      this.redisClient?.disconnect();
      this.redisClient = null;
    }
  }

  private async connectAmqp(): Promise<void> {
    if (!serviceEnabled('AMQP')) {
      this.status.amqp = 'disabled';
      return;
    }
    try {
      this.amqpConn = await amqp.connect(
        process.env.AMQP_URL || 'amqp://guest:guest@amqp:5672'
      );
      this.amqpConn.on('error', () => { this.status.amqp = false; });
      this.amqpConn.on('close', () => { this.status.amqp = false; });
      this.status.amqp = true;
      console.log('AMQP connected');
    } catch (err: any) {
      console.error('AMQP connection failed:', err.message);
      this.amqpConn = null;
    }
  }
}
