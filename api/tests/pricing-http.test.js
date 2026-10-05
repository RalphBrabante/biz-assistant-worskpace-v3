const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, project: require('node:path').join(__dirname, '../tsconfig.json') });
require('reflect-metadata');
const sequelize = require('../src/sequelize');
const roles = { admin: ['administrator'], accountant: ['accountant'], staff: ['staff'], super: ['superuser'] };
const users = Object.fromEntries(Object.entries(roles).map(([key, codes]) => [key, {
  id: key, isActive: true, status: 'active', organizationId: 'org',
  roles: codes.map(code => ({ code, permissions: [{ code: '*' }] })),
  toJSON() { return { id: this.id, organizationId: this.organizationId }; },
}]));
sequelize.getModels = () => ({
  Token: { async findOne(query) { const role = Object.keys(roles).find(key => require('node:crypto').createHash('sha256').update(key).digest('hex') === query.where.tokenHash);
    return role ? { id: 'token', metadata: { organizationId: 'org' }, expiresAt: new Date(Date.now() + 60000), user: users[role] } : null; } },
  User: { async findByPk(id) { return users[id]; } },
  UserRole: { async findAll(query) { return users[query.where.userId].roles.map(role => ({ role })); } },
  OrganizationUser: { async findOne(query) { const user = users[query.where.userId]; return user ? { organizationId: 'org', isActive: true, role: user.roles[0].code } : null; } },
  Role: { async findOne(query) { return Object.values(users).flatMap(user => user.roles).find(role => role.code === query.where.code); } },
  Permission: {}, License: { async findOne() { return {}; } },
});
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { PricingController } = require('../src/modules/pricing/pricing.module');
const { PricingService } = require('../src/modules/pricing/pricing.service');
const { PricingRepository } = require('../src/modules/pricing/pricing.repository');
const { OrdersModule } = require('../src/modules/orders/orders.module');

test('real Nest public endpoints, rate limits, persistent-success contract and platform-only inquiry reads', async () => {
  process.env.PRICING_REQUEST_HASH_SECRET = 'synthetic-pricing-http-secret-with-32-characters';
  const writes = [], limits = new Map(); let reads = 0, failSave = false;
  const repository = {
    async consumeLimit(key, maximum) { const count = limits.get(key) || 0; if (count >= maximum) { const { HttpException } = require('@nestjs/common'); throw new HttpException('Too many requests.', 429); } limits.set(key, count + 1); },
    async save(row) { if (failSave) throw new Error('private database failure'); writes.push(row); return { id: 'saved-reference' }; },
    async list() { reads++; return { count: 1, rows: [{ id: 'private-reference', email: 'private@example.test' }] }; },
  };
  class TestPricingModule {}
  Module({ imports: [OrdersModule], controllers: [PricingController], providers: [{ provide: PricingRepository, useValue: repository }, { provide: PricingService, useValue: new PricingService(repository) }] })(TestPricingModule);
  const app = await NestFactory.create(TestPricingModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  try {
    const anonymous = await fetch(`${base}/pricing/catalogue`); assert.equal(anonymous.status, 200); assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    const publicData = (await anonymous.json()).data; assert.equal(publicData.catalogue.ctaMode, 'request');
    assert.equal((await fetch(`${base}/pricing/catalogue`, { headers: { authorization: 'Bearer invalid' } })).status, 200);
    assert.equal((await fetch(`${base}/pricing/requests`)).status, 401);
    for (const role of ['admin', 'accountant', 'staff']) assert.equal((await fetch(`${base}/pricing/requests`, { headers: { authorization: `Bearer ${role}` } })).status, 403);
    assert.equal(reads, 0);
    const privateResponse = await fetch(`${base}/pricing/requests?organizationId=other`, { headers: { authorization: 'Bearer super' } });
    assert.equal(privateResponse.status, 200); assert.equal((await privateResponse.json()).data[0].email, 'private@example.test'); assert.equal(reads, 1);
    assert.equal((await fetch(`${base}/orders`)).status, 401);
    assert.equal((await fetch(`${base}/pricing/checkout`, { method: 'POST' })).status, 404);
    const body = { name: 'Test Buyer', email: 'buyer@example.test', planId: 'silver', cycle: 'annual', capacity: { organizations: 7, users: 8, storageGB: 25, mailboxes: 3 }, website: '', requestKey: require('node:crypto').randomUUID(), challenge: new PricingService(repository).catalogue(Date.now() - 3000).requestChallenge, subtotalMinor: 1 };
    const post = payload => fetch(`${base}/pricing/requests`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': require('node:crypto').randomUUID() }, body: JSON.stringify(payload) });
    const result = await post(body); assert.equal(result.status, 201); assert.equal((await result.json()).message, 'Your plan request has been received. No payment has been taken.'); assert.equal(writes[0].selectionSnapshot.estimate.subtotalMinor, 5594000);
    failSave = true; const failed = await post({ ...body, email: 'another@example.test' }); assert.equal(failed.status, 503); assert.equal((await failed.json()).data, undefined); assert.equal(writes.length, 1);
    for (let n = 0; n < 3; n++) assert.equal((await post({ ...body, website: 'bot' })).status, 400);
    const throttled = await post(body); assert.equal(throttled.status, 429); assert.equal(throttled.headers.get('retry-after'), '3600');
  } finally { await app.close(); }
});
