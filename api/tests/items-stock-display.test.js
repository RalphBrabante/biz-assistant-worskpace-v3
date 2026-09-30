const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Items list keeps DECIMAL strings exact and requests the existing paginated creation order', async () => {
  const rows = Object.freeze([
    Object.freeze({ id: 'newer', stock: '25.000' }),
    Object.freeze({ id: 'older', stock: '1.125' }),
  ]);
  let query;
  const models = {
    Organization: {}, Vendor: {},
    Item: { async findAndCountAll(options) { query = options; return { rows, count: 12 }; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/controllers/items-controller'), 'utf8'), {
    module, exports: module.exports, console,
    require(name) {
      if (name === '../sequelize') return { getModels: () => models };
      if (name === '../services/request-scope') return {
        isPrivilegedRequest: () => false,
        applyOrganizationWhereScope(where) { where.organizationId = 'fixture-org'; return where; },
      };
      return {};
    },
  });
  let status, response;
  await module.exports.listItems({ query: { page: '2', limit: '10' } }, {
    status(value) { status = value; return this; },
    json(value) { response = value; return this; },
  });
  assert.equal(status, 200);
  assert.equal(query.where.organizationId, 'fixture-org');
  assert.equal(query.limit, 10);
  assert.equal(query.offset, 10);
  assert.equal(JSON.stringify(query.order), JSON.stringify([['createdAt', 'DESC']]));
  assert.strictEqual(response.data, rows);
  assert.deepEqual(JSON.parse(JSON.stringify(response.data)), [
    { id: 'newer', stock: '25.000' }, { id: 'older', stock: '1.125' },
  ]);
  assert.equal(response.meta.page, 2);
  assert.equal(response.meta.total, 12);
  assert.equal(response.meta.totalPages, 2);
});
