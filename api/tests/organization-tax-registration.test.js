const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { prepareTaxReturn, computeTaxReturn } = require('../src/services/bir-tax-return');
const { prepareReportDocuments } = require('../src/services/bir-report-documents');

function setup() {
  const writes = [];
  const organization = { id: 'org-a', name: 'Example', taxTypeId: 'vat', taxType: { code: 'VAT', percentage: 12 },
    taxpayerClassification: 'corporation', country: 'Philippines', currency: 'PHP', taxId: '12345678900000',
    addressLine1: '123 Example Street', city: 'Manila', contactEmail: 'example@example.test', phone: '1234567',
    rdoCode: '039', taxpayerSize: 'small',
    async update(payload) { writes.push(payload); Object.assign(this, payload); } };
  const models = {
    Organization: {
      async create(payload) { writes.push(payload); Object.assign(organization, payload); return organization; },
      async findByPk(id) { return id === organization.id ? organization : null; },
    },
    TaxType: { findOne: async () => organization.taxType },
  };
  const filename = require.resolve('../src/controllers/organizations-controller');
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console,
    require(name) {
      if (name === '../sequelize') return { getModels: () => models };
      if (name === '../services/email-service') return {};
      return originalRequire(name);
    },
  });
  async function call(method, body, orgId = 'org-a') {
    const req = { body, params: { id: orgId }, auth: { user: { organizationId: 'org-a' }, roleCodes: ['administrator'] } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports[method](req, res);
    return res;
  }
  return { organization, writes, call };
}
const required = { name: 'Example', addressLine1: '123 Example Street', city: 'Manila', taxTypeId: 'vat', contactEmail: 'example@example.test', phone: '1234567' };

test('organization creation accepts omitted or blank registration fields and preserves leading zeros', async () => {
  for (const extra of [{}, { rdoCode: '', taxpayerSize: '' }, { rdoCode: ' 039 ', taxpayerSize: ' Small ' }]) {
    const f = setup();
    const res = await f.call('createOrganization', { ...required, ...extra });
    assert.equal(res.statusCode, 201);
    if (!('rdoCode' in extra)) assert.equal(Object.hasOwn(f.writes[0], 'rdoCode'), false);
    else {
      assert.equal(res.body.data.rdoCode, extra.rdoCode.trim() ? '039' : null);
      assert.equal(res.body.data.taxpayerSize, extra.taxpayerSize.trim() ? 'small' : null);
    }
  }
});

test('editing saves, preserves omitted values, and explicitly clears optional fields', async () => {
  const f = setup();
  assert.equal((await f.call('updateOrganization', { rdoCode: '007', taxpayerSize: 'micro' })).statusCode, 200);
  assert.equal(f.organization.rdoCode, '007');
  assert.equal(f.organization.taxpayerSize, 'micro');
  await f.call('updateOrganization', { name: 'Renamed' });
  assert.equal(f.organization.rdoCode, '007');
  assert.equal(f.organization.taxpayerSize, 'micro');
  await f.call('updateOrganization', { rdoCode: null, taxpayerSize: '' });
  assert.equal(f.organization.rdoCode, null);
  assert.equal(f.organization.taxpayerSize, null);
});

test('invalid registration details are rejected without modifying the organization', async () => {
  for (const method of ['createOrganization', 'updateOrganization']) {
    for (const extra of [{ rdoCode: '39' }, { rdoCode: '0039' }, { rdoCode: 'ABC' }, { taxpayerSize: 'unknown' }]) {
      const f = setup();
      const res = await f.call(method, { ...required, ...extra });
      assert.equal(res.statusCode, 400);
      assert.equal(f.writes.length, 0);
    }
  }
});

test('organization registration updates remain scoped to the authenticated organization', async () => {
  const f = setup();
  assert.equal((await f.call('updateOrganization', { rdoCode: '007' }, 'other-org')).statusCode, 404);
  assert.equal(f.writes.length, 0);
});

test('saved profile values flow into VAT and percentage-tax returns and RDO into income-tax documents', async () => {
  const f = setup();
  await f.call('updateOrganization', { rdoCode: '007', taxpayerSize: 'micro' });
  for (const code of ['VAT', 'PT']) {
    const organization = { ...f.organization, taxType: { code, percentage: code === 'VAT' ? 12 : 3 } };
    const prep = prepareTaxReturn(organization, [], [], 2026, 3);
    assert.equal(prep.defaults.rdoCode, '007');
    assert.equal(prep.defaults.taxpayerSize, 'micro');
    const result = computeTaxReturn(prep);
    assert.equal(result.values.rdoCode, '007');
    assert.equal(result.values.taxpayerSize, 'micro');
    const override = computeTaxReturn(prep, { rdoCode: '039', taxpayerSize: 'small' });
    assert.equal(override.values.rdoCode, '039');
    assert.equal(organization.rdoCode, '007');
    const documents = prepareReportDocuments(organization, [], [], 2026, 3);
    assert.equal(documents.find(doc => doc.id === '1702Q').defaults.rdoCode, '007');
  }
});

test('blank optional profile values remain blank and changing them invalidates report revisions', () => {
  const f = setup();
  const original = prepareTaxReturn(f.organization, [], [], 2026, 3);
  const blank = prepareTaxReturn({ ...f.organization, rdoCode: null, taxpayerSize: null }, [], [], 2026, 3);
  assert.equal(blank.defaults.rdoCode, '');
  assert.equal(blank.defaults.taxpayerSize, '');
  assert.notEqual(original.sourceRevision, blank.sourceRevision);
  assert.throws(() => computeTaxReturn(blank), /RDO/);
});
