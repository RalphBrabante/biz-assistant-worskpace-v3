const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize } = require('sequelize');
const { initVendorModel } = require('../src/models/vendor');

// Validate through Sequelize without connecting to or modifying a database.
const sequelize = new Sequelize('test', 'test', 'test', { dialect: 'mysql', logging: false });
const Vendor = initVendorModel(sequelize);
after(() => sequelize.close());
const build = (fields = {}) => Vendor.build({
  organizationId: 'ed51fda6-7a34-4e54-9391-851b9465b20a', name: 'Test vendor', ...fields,
});

test('vendors accept an omitted, null, empty or whitespace-only email', async () => {
  for (const fields of [{}, { contactEmail: null }, { contactEmail: '' }, { contactEmail: '   ' }]) {
    const vendor = build(fields);
    await vendor.validate();
    assert.equal(vendor.contactEmail ?? null, null);
  }
});

test('clearing an existing vendor email stores null', async () => {
  const vendor = build({ contactEmail: 'vendor@example.com' });
  vendor.set('contactEmail', '  ');
  await vendor.validate();
  assert.equal(vendor.contactEmail, null);
});

test('provided vendor emails are trimmed and still validated', async () => {
  const vendor = build({ contactEmail: ' vendor@example.com ' });
  await vendor.validate();
  assert.equal(vendor.contactEmail, 'vendor@example.com');
  await assert.rejects(build({ contactEmail: 'not-an-email' }).validate(), (error) =>
    error.name === 'SequelizeValidationError' && error.errors.some((item) => item.path === 'contactEmail'));
});
