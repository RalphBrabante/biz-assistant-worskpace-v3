const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, project: require('node:path').join(__dirname, '../tsconfig.json') });
const { PRICING_CATALOGUE: catalogue, assertPreviewPublication, estimatePlan, recommendPlan, capacityErrors } = require('../src/modules/pricing/pricing-domain');
const { PricingService, REQUEST_SUCCESS } = require('../src/modules/pricing/pricing.service');
const { pricingRequestIp } = require('../src/modules/pricing/pricing-request-ip');
process.env.PRICING_REQUEST_HASH_SECRET = 'synthetic-pricing-test-secret-with-32-characters';
const desired = { organizations: 7, users: 8, storageGB: 25, mailboxes: 3 };
test('rate identity ignores spoofed forwarding headers unless socket proxy is explicitly trusted', () => {
  const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '192.0.2.99, 198.51.100.10, 10.0.0.2' } };
  assert.equal(pricingRequestIp(req, ''), '127.0.0.1');
  assert.equal(pricingRequestIp(req, '127.0.0.1,10.0.0.2'), '198.51.100.10');
  req.headers['x-forwarded-for'] = 'forged'; assert.equal(pricingRequestIp(req, '127.0.0.1'), '127.0.0.1');
  assert.throws(() => pricingRequestIp(req, 'true'), /explicit IP/);
  assert.throws(() => pricingRequestIp(req, '0.0.0.0/0'), /explicit IP/);
});
function setup() {
  const rows = [], limits = new Map();
  const repository = {
    async consumeLimit(key, maximum) { const count = limits.get(key) || 0; if (count >= maximum) { const { HttpException } = require('@nestjs/common'); throw new HttpException('Too many requests.', 429); } limits.set(key, count + 1); },
    async save(row) { rows.push(row); return { id: 'persisted-receipt' }; },
  };
  const service = new PricingService(repository);
  const issuedAt = Date.now();
  const body = { name: 'Test Accountant', email: 'accountant@example.test', firmName: '', planId: 'silver', cycle: 'monthly', capacity: desired, requestKey: require('node:crypto').randomUUID(), website: '', challenge: service.catalogue(issuedAt).requestChallenge };
  return { rows, repository, service, body, now: issuedAt + 3000 };
}
test('all proposal prices, capacities, annual saving, add-on eligibility and publication states are exact', () => {
  assert.equal(catalogue.version, '2026-10-launch-proposal-v1'); assert.equal(catalogue.currency, 'PHP');
  assert.deepEqual(catalogue.plans.map(p => [p.id, p.monthlyAmountMinor, p.annualAmountMinor, p.includedOrganizations, p.includedUsers, p.includedStorageGB, p.includedMailboxes]), [
    ['bronze', 149900, 1499000, 1, 2, 5, 1], ['silver', 399900, 3999000, 5, 5, 25, 3], ['gold', 899900, 8999000, 20, 15, 100, 10],
  ]);
  assert.deepEqual(catalogue.addons.map(a => [a.id, a.monthlyAmountMinor, a.annualAmountMinor]), [ ['extra_user', 19900, 199000], ['extra_organization', 49900, 499000], ['storage_10gb', 14900, 149000], ['extra_mailbox', 14900, 149000] ]);
  for (const item of [...catalogue.plans, ...catalogue.addons]) {
    assert.equal(item.annualAmountMinor, item.monthlyAmountMinor * 10);
    assert.equal(item.monthlyAmountMinor * 12 - item.annualAmountMinor, item.monthlyAmountMinor * 2);
    assert.equal(Number(((1 - item.annualAmountMinor / (item.monthlyAmountMinor * 12)) * 100).toFixed(1)), 16.7);
  }
  for (const addon of catalogue.addons) assert.deepEqual(addon.eligiblePlanIds, ['bronze', 'silver', 'gold']);
  assertPreviewPublication(catalogue);
  for (const mutation of [{ launchMode: 'live' }, { ctaMode: 'checkout' }, { trialEnabled: true }, { taxDisplayMode: 'inclusive' }, { taxDisplayMode: 'exclusive' }]) assert.throws(() => assertPreviewPublication({ ...catalogue, ...mutation }));
});
test('Silver for 7 organizations, 8 users, 25 GB and 3 mailboxes is PHP 5594 monthly / 55940 annually', () => {
  for (const [cycle, amount] of [['monthly', 559400], ['annual', 5594000]]) {
    const quote = estimatePlan(catalogue, 'silver', desired, cycle); assert.equal(quote.subtotalMinor, amount);
    assert.deepEqual(quote.lines.map(l => l.quantity), [3, 2, 0, 0]); assert.equal(recommendPlan(catalogue, desired, cycle).planId, 'silver');
  }
});
test('storage packs round up only above included storage and all add-ons use integer centavos', () => {
  for (const [storageGB, packs] of [[5, 0], [5.0001, 1], [15, 1], [15.01, 2], [25, 2]]) {
    const quote = estimatePlan(catalogue, 'bronze', { organizations: 1, users: 2, storageGB, mailboxes: 1 }, 'annual');
    assert.equal(quote.lines.find(l => l.id === 'storage_10gb').quantity, packs);
    assert.equal(quote.subtotalMinor, 1499000 + packs * 149000);
  }
  const quote = estimatePlan(catalogue, 'gold', { organizations: 21, users: 16, storageGB: 100.5, mailboxes: 11 }, 'monthly');
  assert.deepEqual(quote.lines.map(l => l.quantity), [1, 1, 1, 1]); assert.equal(quote.subtotalMinor, 999500);
});
test('empty, strings, fractional counts, infinities, negatives and excessive quantities are invalid', () => {
  for (const key of ['organizations', 'users', 'storageGB', 'mailboxes']) {
    for (const value of [null, undefined, '', '2', NaN, Infinity, -1, 1000001, ...(key === 'storageGB' ? [] : [1.5])]) {
      const input = { ...desired, [key]: value }; assert.ok(capacityErrors(input)[key]); assert.throws(() => estimatePlan(catalogue, 'silver', input, 'monthly'));
    }
  }
  assert.ok(capacityErrors({ ...desired, users: 0 }).users); assert.ok(capacityErrors(null).organizations);
  assert.throws(() => estimatePlan(catalogue, 'silver', desired, 'weekly')); assert.throws(() => estimatePlan(catalogue, 'unknown', desired, 'monthly'));
});
test('cheapest eligible recommendation changes with capacity and respects feature availability and add-on eligibility', () => {
  const small = { organizations: 1, users: 1, storageGB: 0, mailboxes: 0 };
  assert.equal(recommendPlan(catalogue, small, 'monthly').planId, 'bronze');
  assert.equal(recommendPlan(catalogue, { organizations: 20, users: 15, storageGB: 100, mailboxes: 10 }, 'monthly').planId, 'gold');
  const differentiated = structuredClone(catalogue); differentiated.plans[0].includedFeatureIds = [];
  assert.equal(recommendPlan(differentiated, small, 'monthly', ['sales']).planId, 'silver');
  assert.equal(recommendPlan(catalogue, small, 'monthly', ['support']), null);
  const planned = structuredClone(catalogue); planned.features.find(f => f.id === 'sales').availability = 'planned';
  assert.equal(recommendPlan(planned, small, 'monthly', ['sales']), null);
  const limited = structuredClone(catalogue); limited.addons.find(a => a.id === 'extra_organization').eligiblePlanIds = ['gold'];
  assert.equal(recommendPlan(limited, desired, 'monthly').planId, 'gold');
  assert.equal(estimatePlan(catalogue, 'gold', { ...small, organizations: 51 }, 'monthly').largeConfiguration, true);
  assert.equal(estimatePlan(catalogue, 'gold', { ...small, users: 51 }, 'monthly').largeConfiguration, true);
});
test('server ignores forged prices, version, taxes and identity, and snapshots authoritative selection only after persistence', async () => {
  const e = setup(); const result = await e.service.submit({ ...e.body, subtotalMinor: 1, taxAmountMinor: 0, catalogueVersion: 'forged', createdBy: 'fake', organizationId: 'fake' }, '127.0.0.1', e.now);
  assert.equal(result.message, REQUEST_SUCCESS); assert.equal(e.rows.length, 1);
  const row = e.rows[0]; assert.equal(row.catalogueVersion, catalogue.version); assert.equal(row.selectionSnapshot.estimate.subtotalMinor, 559400);
  assert.equal(row.selectionSnapshot.taxAmountMinor, null); assert.equal(row.selectionSnapshot.bindingOffer, false);
  assert.equal(row.marketingConsent, false); assert.equal(row.createdBy, undefined); assert.equal(row.organizationId, undefined);
  assert.equal(JSON.stringify(row).includes('127.0.0.1'), false);
});
test('invalid quantities, plans, emails, honeypot and signed challenge are rejected without saving', async () => {
  for (const mutation of [{ planId: 'platinum' }, { cycle: 'weekly' }, { email: 'invalid' }, { name: ' ' }, { capacity: { ...desired, users: '8' } }, { marketingConsent: 'true' }, { website: 'spam' }, { challenge: 'forged' }, { requestKey: '' }]) {
    const e = setup(); await assert.rejects(() => e.service.submit({ ...e.body, ...mutation }, '127.0.0.1', e.now), error => error.getStatus() === 400); assert.equal(e.rows.length, 0);
  }
  for (const age of [1000, 7200001, -1000]) { const e = setup(); await assert.rejects(() => e.service.submit(e.body, 'ip', e.now - 3000 + age), error => error.getStatus() === 400); }
});
test('IP limits also cover invalid attempts, email limits apply across IPs and failures cannot report success', async () => {
  const e = setup();
  for (let n = 0; n < 5; n++) await assert.rejects(() => e.service.submit({ ...e.body, website: 'spam' }, 'ip', e.now), error => error.getStatus() === 400);
  await assert.rejects(() => e.service.submit(e.body, 'ip', e.now), error => error.getStatus() === 429);
  const f = setup(); for (let n = 0; n < 3; n++) await f.service.submit(f.body, `ip-${n}`, f.now);
  await assert.rejects(() => f.service.submit(f.body, 'ip-4', f.now), error => error.getStatus() === 429);
  const failure = setup(); failure.repository.save = async () => { throw new Error('database unavailable'); };
  await assert.rejects(() => failure.service.submit(failure.body, 'ip', failure.now), /database unavailable/); assert.equal(failure.rows.length, 0);
});
test('missing secret disables requests but keeps catalogue available; canonical uses configured HTTPS origin only', async () => {
  const secret = process.env.PRICING_REQUEST_HASH_SECRET, base = process.env.APP_BASE_URL;
  try {
    const e = setup(); delete process.env.PRICING_REQUEST_HASH_SECRET;
    assert.equal(e.service.catalogue().requestChallenge, null);
    await assert.rejects(() => e.service.submit(e.body, 'ip', e.now), error => error.getStatus() === 503);
    for (const invalid of ['', 'http://example.test', 'https://user:pass@example.test']) { process.env.APP_BASE_URL = invalid; assert.equal(e.service.catalogue().canonicalUrl, null); }
    process.env.APP_BASE_URL = 'https://app.example.test/'; assert.equal(e.service.catalogue().canonicalUrl, 'https://app.example.test/pricing');
  } finally { process.env.PRICING_REQUEST_HASH_SECRET = secret; if (base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = base; }
});
