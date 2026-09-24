const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const routes = {
  items: ['items', 'createItem', { name: 'Item' }, 'Item'],
  customers: ['customers', 'createCustomer', { name: 'Customer', taxId: 'TIN' }, 'Customer'],
  invoices: ['sales-invoices', 'createSalesInvoice', { invoiceNumber: 'INV-1', issueDate: '2026-09-23', amount: 112 }, 'SalesInvoice'],
  licenses: ['licenses', 'createLicense', { planName: 'Basic', expiresAt: '2027-09-23' }, 'License'],
  withholding: ['withholding-tax-types', 'createWithholdingTaxType', { code: 'EWT', name: 'EWT', percentage: 2 }, 'WithholdingTaxType'],
  users: ['users', 'createUser', { firstName: 'New', lastName: 'User', email: 'test@example.com', password: 'test-only', roleIds: ['role'] }, 'User'],
  vendors: ['vendors', 'createVendor', { name: 'Vendor' }, 'Vendor'],
  salesReports: ['reports', 'computeQuarterlySalesInvoiceReport', { year: 2026, quarter: 3 }, 'QuarterlySalesReport'],
  expenseReports: ['reports', 'computeQuarterlyExpenseReport', { year: 2026, quarter: 3 }, 'QuarterlyExpenseReport'],
};

function setup(route, { body = {}, privileged = true, userIdOnly = false } = {}) {
  const [file, method, requiredBody, targetModel] = routes[route];
  const writes = [];
  const errors = [];
  const organizations = new Map(['org', 'other-org'].map((id) => [id, {
    id, currency: 'PHP', taxTypeId: 'vat', taxType: { code: 'VAT', percentage: 12, isActive: true },
    getUsers: async () => [],
  }]));
  function model(name) {
    let saved;
    return {
      async create(payload) {
        // Enforce the references under test without using a live database.
        if (payload.organizationId != null && !organizations.has(payload.organizationId)) throw new Error('Invalid organization reference');
        for (const field of ['createdBy', 'updatedBy']) {
          if (payload[field] != null && payload[field] !== 'actor') throw new Error(`Invalid ${field} reference`);
        }
        for (const [field, id] of [['vendorId', 'vendor'], ['withholdingTaxTypeId', 'ewt']]) {
          if (payload[field] != null && payload[field] !== id) throw new Error(`Invalid ${field} reference`);
        }
        writes.push({ model: name, payload });
        saved = { id: `${name}-new`, ...payload, toJSON: () => ({ ...payload }) };
        return saved;
      },
      async findByPk() { return saved; },
      async findOne() { return null; },
      async findAll() { return []; },
      async findOrCreate({ defaults }) { return [await this.create(defaults), true]; },
      async update() {},
      async destroy() {},
    };
  }
  const models = Object.fromEntries([
    'Item', 'Customer', 'SalesInvoice', 'License', 'WithholdingTaxType', 'User', 'Vendor',
    'Expense', 'QuarterlySalesReport', 'QuarterlyExpenseReport', 'VendorOrganization',
  ].map((name) => [name, model(name)]));
  models.Expense.sequelize = { transaction: async (_options, callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }) };
  models.Organization = {
    async findByPk(id) { return organizations.get(id) || null; },
    async findAll({ where }) { return where.id.map((id) => organizations.get(id)).filter(Boolean); },
  };
  models.Role = { findAll: async () => [{ id: 'role', code: 'member' }] };
  models.UserRole = { bulkCreate: async () => {} };
  models.Token = { update: async () => {}, create: async () => {} };
  models.Vendor.findOne = async ({ where }) => where.id === 'vendor' && where.organizationId === 'org'
    ? { id: 'vendor', organizationId: 'org' } : null;
  models.WithholdingTaxType.findOne = async ({ where }) => where.id === 'ewt' && where.organizationId === 'org'
    ? { id: 'ewt', percentage: 2 } : null;
  models.OrganizationUser = {
    findOrCreate: async () => [{}, true], update: async () => {},
    findOne: async () => null,
  };
  models.VendorOrganization.findOrCreate = async ({ defaults }) => {
    if (!organizations.has(defaults.organizationId)) throw new Error('Invalid shared organization');
    writes.push({ model: 'VendorOrganization', payload: defaults });
    return [{ ...defaults, update: async () => {} }, true];
  };
  const mocks = {
    '../sequelize': { getModels: () => models },
    '../services/organization-currency': { getOrganizationCurrency: async () => 'PHP' },
    '../services/message-service': { createOrganizationMessage: async () => {}, getActorDisplayName: () => 'Actor' },
    '../services/email-service': { sendOrganizationUserInviteEmail: async () => {} },
    '../services/storage-service': {},
  };
  const filename = path.join(__dirname, `../src/controllers/${file}-controller.js`);
  const requireActual = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, process,
    console: { error: (...args) => errors.push(args), warn: () => {} },
    require: (name) => mocks[name] || requireActual(name),
  }, { filename });
  const req = {
    body: { organizationId: 'org', ...requiredBody, ...body }, query: {}, params: {},
    auth: { userId: 'actor', user: { ...(userIdOnly ? {} : { id: 'actor' }), organizationId: 'org' }, roleCodes: privileged ? ['superuser'] : [] },
    get: () => '',
  };
  const res = { status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  return {
    writes, req, models,
    payload: () => writes.find((write) => write.model === targetModel)?.payload,
    async create(handler = method) {
      await module.exports[handler](req, res, (err) => { throw err; });
      assert.equal(errors.length, 0, `Unexpected controller error: ${errors.map((entry) => entry.join(' ')).join('; ')}`);
      return res;
    },
  };
}

for (const route of ['items', 'customers', 'invoices', 'vendors']) {
  for (const auditFields of [{ createdBy: 'deleted-user', updatedBy: 'deleted-user' }, { createdBy: '', updatedBy: '' }, {}]) {
    test(`${route}: create uses authenticated audit IDs for ${JSON.stringify(auditFields)}`, async () => {
      const f = setup(route, { body: auditFields });
      assert.equal((await f.create()).statusCode, 201);
      assert.equal(f.payload().createdBy, 'actor');
      assert.equal(f.payload().updatedBy, 'actor');
    });
  }
  test(`${route}: audit IDs also resolve from auth.userId`, async () => {
    const f = setup(route, { userIdOnly: true, body: { createdBy: 'stale', updatedBy: 'stale' } });
    assert.equal((await f.create()).statusCode, 201);
    assert.equal(f.payload().createdBy, 'actor');
    assert.equal(f.payload().updatedBy, 'actor');
  });
}

for (const [route, field, validId] of [['items', 'vendorId', 'vendor'], ['invoices', 'withholdingTaxTypeId', 'ewt'], ['licenses', 'organizationId', 'org']]) {
  for (const blank of ['', '  ', null, undefined]) {
    test(`${route}: blank ${field} ${JSON.stringify(blank)} is stored as NULL`, async () => {
      const f = setup(route, { body: { [field]: blank } });
      assert.equal((await f.create()).statusCode, 201);
      assert.equal(f.payload()[field], null);
    });
  }
  test(`${route}: a valid ${field} is retained`, async () => {
    const f = setup(route, { body: { [field]: ` ${validId} ` } });
    assert.equal((await f.create()).statusCode, 201);
    assert.equal(f.payload()[field], validId);
  });
  test(`${route}: an invalid ${field} is rejected before insertion`, async () => {
    const f = setup(route, { body: { [field]: 'missing' } });
    assert.equal((await f.create()).statusCode, 400);
    assert.equal(f.writes.length, 0);
  });
}

for (const route of Object.keys(routes)) {
  test(`${route}: missing organization is rejected before any write`, async () => {
    const f = setup(route, { body: { organizationId: 'deleted-org' } });
    const res = await f.create();
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /organization/i);
    assert.equal(f.writes.length, 0);
  });
  test(`${route}: a valid organization still permits creation`, async () => {
    const f = setup(route);
    assert.equal((await f.create()).statusCode, 201);
    assert.equal(f.payload().organizationId, 'org');
  });
}

test('vendor creation validates shared organizations before saving the vendor', async () => {
  const f = setup('vendors', { body: { organizationIds: ['org', 'deleted-org'] } });
  assert.equal((await f.create()).statusCode, 400);
  assert.equal(f.writes.length, 0);
});

test('vendor creation still saves valid shared organization links', async () => {
  const f = setup('vendors', { body: { organizationIds: ['org', 'other-org'] } });
  assert.equal((await f.create()).statusCode, 201);
  assert.equal(f.writes.filter((write) => write.model === 'VendorOrganization').length, 2);
});

for (const route of ['items', 'customers', 'invoices', 'licenses', 'withholding', 'users', 'vendors']) {
  test(`${route}: ordinary users retain their authenticated organization scope`, async () => {
    const f = setup(route, { privileged: false, body: { organizationId: 'other-org' } });
    assert.equal((await f.create()).statusCode, 201);
    assert.equal(f.payload().organizationId, 'org');
  });
}

for (const [route, handler] of [['items', 'importItems'], ['customers', 'importCustomers'], ['vendors', 'importVendors']]) {
  for (const organizationId of ['org', 'deleted-org']) {
    test(`${route} CSV import validates organization ${organizationId} before writing`, async () => {
      const f = setup(route, { body: { organizationId } });
      f.req.file = { buffer: Buffer.from('name,taxId,createdBy,updatedBy\nImported,TIN,stale,stale\n') };
      const res = await f.create(handler);
      if (organizationId === 'org') {
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.imported, 1);
        assert.equal(f.payload().createdBy, 'actor');
        assert.equal(f.payload().updatedBy, 'actor');
      } else {
        assert.equal(res.statusCode, 400);
        assert.equal(f.writes.length, 0);
      }
    });
  }
}
