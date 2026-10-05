import { Injectable, HttpException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { assertPreviewPublication, capacityErrors, estimatePlan, PRICING_CATALOGUE } from './pricing-domain';
import { PricingRepository } from './pricing.repository';

export const REQUEST_SUCCESS = 'Your plan request has been received. No payment has been taken.';
@Injectable()
export class PricingService {
  constructor(private readonly repository: PricingRepository) {}
  private secret(): string {
    const secret = process.env.PRICING_REQUEST_HASH_SECRET || '';
    if (secret.length < 32) throw new HttpException('Plan requests are temporarily unavailable. Please try again later.', 503);
    return secret;
  }
  private hash(value: string) { return createHmac('sha256', this.secret()).update(value).digest('hex'); }
  catalogue(now = Date.now()) {
    assertPreviewPublication(PRICING_CATALOGUE);
    let requestChallenge: string | null = null;
    if ((process.env.PRICING_REQUEST_HASH_SECRET || '').length >= 32) {
      const content = `${now}.${randomBytes(16).toString('hex')}`;
      requestChallenge = `${content}.${this.hash(`challenge:${content}`)}`;
    }
    let canonicalUrl: string | null = null;
    try {
      const url = new URL(process.env.APP_BASE_URL || '');
      if (url.protocol === 'https:' && !url.username && !url.password) canonicalUrl = `${url.origin}/pricing`;
    } catch { /* No host-derived canonical fallback. */ }
    return { catalogue: PRICING_CATALOGUE, requestChallenge, canonicalUrl };
  }
  async submit(body: any, ip: string, now = Date.now()) {
    assertPreviewPublication(PRICING_CATALOGUE);
    const bucket = Math.floor(now / 3600000);
    const expiresAt = new Date((bucket + 1) * 3600000);
    await this.repository.consumeLimit(this.hash(`ip:${ip}:${bucket}`), 5, expiresAt);
    const fail = (message: string) => { throw new HttpException(message, 400); };
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Please complete the plan request form.');
    if (body.website !== '') fail('Unable to accept this request. Please use the plan request form.');
    const parts = typeof body.challenge === 'string' ? body.challenge.split('.') : [];
    const content = parts.slice(0, 2).join('.');
    const signature = parts[2] || '';
    const expected = this.hash(`challenge:${content}`);
    const issuedAt = Number(parts[0]);
    if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      || !Number.isFinite(issuedAt) || now - issuedAt < 2000 || now - issuedAt > 7200000) {
      fail('Please refresh the request form and try again.');
    }
    const text = (value: any, maximum: number, optional = false): string => {
      if (optional && (value === undefined || value === null || value === '')) return '';
      if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\x00-\x1f\x7f]/.test(value)) fail('Please enter valid contact details.');
      return value.trim();
    };
    const name = text(body.name, 120);
    const email = text(body.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Please enter a valid work email.');
    const firmName = text(body.firmName, 160, true);
    if (body.marketingConsent !== undefined && typeof body.marketingConsent !== 'boolean') fail('Invalid consent value.');
    if (!PRICING_CATALOGUE.plans.some(plan => plan.id === body.planId) || !['monthly', 'annual'].includes(body.cycle)) fail('Please select a valid plan and billing cycle.');
    if (Object.keys(capacityErrors(body.capacity)).length) fail('Please enter valid capacity quantities.');
    if (typeof body.requestKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestKey)) fail('Invalid request key.');
    const capacity = { organizations: body.capacity.organizations, users: body.capacity.users, storageGB: body.capacity.storageGB, mailboxes: body.capacity.mailboxes };
    const estimate = estimatePlan(PRICING_CATALOGUE, body.planId, capacity, body.cycle);
    const normalized = { name, email, firmName: firmName || null, marketingConsent: body.marketingConsent === true, planId: body.planId, cycle: body.cycle, capacity };
    const payloadHash = this.hash(JSON.stringify(normalized));
    await this.repository.consumeLimit(this.hash(`email:${email}:${bucket}`), 3, expiresAt);
    const receipt = await this.repository.save({
      name, email, firmName: firmName || null, marketingConsent: normalized.marketingConsent,
      requestKeyHash: this.hash(`key:${body.requestKey}`), payloadHash,
      dedupeHash: this.hash(`duplicate:${payloadHash}:${Math.floor(now / 86400000)}`),
      catalogueVersion: PRICING_CATALOGUE.version,
      selectionSnapshot: { planId: body.planId, cycle: body.cycle, capacity, currency: 'PHP',
        taxDisplayMode: PRICING_CATALOGUE.taxDisplayMode, launchMode: PRICING_CATALOGUE.launchMode,
        estimate, bindingOffer: false, taxAmountMinor: null },
    });
    return { data: receipt, message: REQUEST_SUCCESS };
  }
}
