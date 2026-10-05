import { Injectable, HttpException } from '@nestjs/common';
import { Op } from 'sequelize';
const { getModels } = require('../../sequelize');

@Injectable()
export class PricingRepository {
  private models() {
    const models = getModels();
    if (!models?.PricingRequest || !models?.PricingRequestLimit) throw new HttpException('Plan requests are temporarily unavailable. Please try again.', 503);
    return models;
  }
  /** Shared database limits; client forwarding headers are never used as identity. */
  async consumeLimit(id: string, maximum: number, expiresAt: Date): Promise<void> {
    const { PricingRequestLimit } = this.models();
    const sequelize = PricingRequestLimit.sequelize;
    await sequelize.transaction(async transaction => {
      await sequelize.query('INSERT INTO pricing_request_limits (id, attempts, expires_at) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE id = id', { replacements: [id, expiresAt], transaction });
      const row = await PricingRequestLimit.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (row.attempts >= maximum) throw new HttpException('Too many plan requests. Please try again in an hour.', 429);
      await row.update({ attempts: row.attempts + 1 }, { transaction });
    });
    // Bound cleanup work. These hashes do not retain raw IP addresses.
    await PricingRequestLimit.destroy({ where: { expiresAt: { [Op.lt]: new Date() } }, limit: 100 }).catch(() => undefined);
  }
  async save(values: any): Promise<{ id: string }> {
    const { PricingRequest } = this.models();
    try {
      const row = await PricingRequest.create(values);
      return { id: row.id };
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;
      // A UNIQUE index arbitrates concurrent/repeated submissions, across processes.
      const byKey = await PricingRequest.findOne({ where: { requestKeyHash: values.requestKeyHash } });
      if (byKey && byKey.payloadHash !== values.payloadHash) throw new HttpException('This request key was already used. Please start a new request.', 409);
      const row = byKey || await PricingRequest.findOne({ where: { dedupeHash: values.dedupeHash } });
      if (!row || row.payloadHash !== values.payloadHash) throw error;
      return { id: row.id };
    }
  }
  async list(page: number) {
    return this.models().PricingRequest.findAndCountAll({ order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 50, offset: (page - 1) * 50,
      attributes: ['id', 'name', 'email', 'firmName', 'marketingConsent', 'catalogueVersion', 'selectionSnapshot', 'createdAt'] });
  }
}
