const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../src/controllers/bug-reports-controller.js');
const originalRequire = createRequire(filename);

function setup({roles = ['staff'], organizationId = 'org-a', updated = 1, unavailable = false, reportExists = true} = {}) {
  const writes = [], reads = [], updates = [], columnWrites = [], columnReads = [];
  const customColumns = [
    {id: 'custom-a', organizationId: 'org-a', name: 'Needs testing', color: 'violet'},
    {id: 'custom-b', organizationId: 'org-b', name: 'Needs testing', color: 'blue'},
  ];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const models = {
    Organization: {findByPk: async id => id === 'missing' ? null : {id}},
    BugReportColumn: {
      findOne: async query => {columnReads.push(query); return customColumns.find(row => matches(row, query.where)) || null;},
      findAll: async query => {columnReads.push(query); return customColumns.filter(row => matches(row, query.where)).map(row => ({toJSON: () => row}));},
      create: async payload => {columnWrites.push(payload); if (payload.name === 'Duplicate') {const error = new Error('duplicate'); error.name = 'SequelizeUniqueConstraintError'; throw error;} return {id: 'new-column', ...payload};},
    },
    BugReport: {
      findOne: async query => reportExists && (!query.where.organizationId || query.where.organizationId === 'org-a') ? {id: 'report-1', organizationId: 'org-a', status: 'open'} : null,
      findAll: async query => {reads.push(query); return query.group ? [{status: 'open', total: 23}, {status: 'custom-a', total: 5}] : [];},
      create: async payload => {writes.push(payload); return {id: 'report-1', ...payload};},
      findAndCountAll: async query => {reads.push(query); return {rows: [], count: 23};},
      update: async (payload, query) => {updates.push({payload, query}); return [updated];},
    },
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console: {error() {}},
    require: name => name === '../sequelize' ? {getModels: () => unavailable ? null : models} : originalRequire(name),
  });
  async function request(method, {body = {}, query = {}, authenticated = true} = {}) {
    const req = {body, query, params: {id: 'report-1'}, auth: authenticated ? {userId: 'reporter-1', user: {id: 'reporter-1', organizationId}, roleCodes: roles, permissions: new Set(['*', 'bug_reports.read']), isPrivileged: true} : undefined};
    const res = {statusCode: 200, headers: {}, set(key, value) {this.headers[key] = value; return this;}, status(code) {this.statusCode = code; return this;}, json(body) {this.body = body; return this;}};
    await module.exports[method](req, res);
    return res;
  }
  return {request, writes, reads, updates, columnWrites, columnReads};
}
const valid = {title: 'Cannot save an expense', description: 'Save returns an error.', steps: 'Open an expense and click Save.', expectedResult: 'Saved expense', pagePath: '/expenses/123?token=secret#private'};

test('signed-in staff can submit, with identity, status and organization enforced by the server', async () => {
  const e = setup(); const res = await e.request('createBugReport', {body: {...valid, createdBy: 'forged', updatedBy: 'forged', status: 'resolved', organizationId: 'org-b'}});
  assert.equal(res.statusCode, 201); assert.deepEqual(Object.keys(res.body.data), ['id']);
  assert.equal(e.writes[0].organizationId, 'org-a'); assert.equal(e.writes[0].createdBy, 'reporter-1');
  assert.equal(e.writes[0].updatedBy, 'reporter-1'); assert.equal(e.writes[0].status, 'open');
  assert.equal(e.writes[0].pagePath, '/expenses/123');
});

test('ordinary users cannot read even their own reports or change status despite broad permissions', async () => {
  const e = setup();
  assert.equal((await e.request('listBugReports')).statusCode, 403);
  assert.equal((await e.request('updateBugReport', {body: {status: 'resolved'}})).statusCode, 403);
  assert.equal(e.reads.length, 0); assert.equal(e.updates.length, 0);
});

test('administrators cannot read or update reports outside their authenticated organization', async () => {
  const e = setup({roles: ['administrator']});
  const res = await e.request('listBugReports', {query: {organizationId: 'org-b', status: 'open', page: 2}});
  assert.equal(e.reads[0].where.organizationId, 'org-a'); assert.equal(e.reads[0].where.status, 'open');
  assert.equal(e.reads[0].offset, 20); assert.equal(res.body.meta.totalPages, 2);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  await e.request('updateBugReport', {query: {organizationId: 'org-b'}, body: {status: 'resolved', organizationId: 'org-b', title: 'overwrite', updatedBy: 'forged'}});
  assert.equal(e.updates[0].query.where.organizationId, 'org-a'); assert.equal(e.updates[0].query.where.id, 'report-1');
  assert.equal(e.updates[0].payload.updatedBy, 'reporter-1'); assert.equal(e.updates[0].payload.title, undefined);
  assert.equal((await setup({roles: ['administrator'], reportExists: false}).request('updateBugReport', {body: {status: 'resolved'}})).statusCode, 404);
});

test('superusers can review all organizations or filter, and submit a global report', async () => {
  const e = setup({roles: ['superuser']});
  await e.request('listBugReports'); assert.equal(e.reads[0].where.organizationId, undefined);
  await e.request('listBugReports', {query: {organizationId: 'org-b'}}); assert.equal(e.reads[1].where.organizationId, 'org-b');
  await e.request('createBugReport', {body: valid}); assert.equal(e.writes[0].organizationId, null);
  assert.equal((await e.request('createBugReport', {body: {...valid, organizationId: 'missing'}})).statusCode, 400);
});

test('missing authentication or organization fails closed', async () => {
  const e = setup({roles: ['administrator'], organizationId: null});
  for (const method of ['createBugReport', 'listBugReports', 'updateBugReport']) {
    assert.equal((await e.request(method, {authenticated: false})).statusCode, 401);
  }
  assert.equal((await e.request('listBugReports')).statusCode, 403);
  assert.equal((await e.request('updateBugReport', {body: {status: 'open'}})).statusCode, 403);
  assert.equal((await e.request('createBugReport', {body: valid})).statusCode, 403);
});

test('submission validation rejects blank, oversized, non-text and external page values', async () => {
  const e = setup();
  for (const patch of [{title: '  '}, {description: ''}, {title: 'x'.repeat(201)}, {description: 'x'.repeat(10001)}, {steps: 'x'.repeat(5001)}, {expectedResult: 'x'.repeat(5001)}, {description: {}}, {pagePath: 'https://example.com'}, {pagePath: '//example.com'}, {pagePath: '/\\example.com'}, {pagePath: '/a\nb'}]) {
    assert.equal((await e.request('createBugReport', {body: {...valid, ...patch}})).statusCode, 400, JSON.stringify(patch).slice(0, 100));
  }
  assert.equal(e.writes.length, 0);
});

test('review validates page and status, and unavailable storage is reported', async () => {
  const e = setup({roles: ['administrator']});
  for (const query of [{page: 'bad'}, {page: -1}, {page: 1.5}, {status: 'unknown'}]) assert.equal((await e.request('listBugReports', {query})).statusCode, 400);
  assert.equal((await e.request('updateBugReport', {body: {status: 'unknown'}})).statusCode, 400);
  assert.equal((await setup({unavailable: true}).request('createBugReport', {body: valid})).statusCode, 503);
});

test('private report endpoints bypass API response caching', async () => {
  const {readCacheMiddleware} = require('../src/middleware/cache');
  for (const path of ['/api/v1/bug-reports', '/bug-reports', '/bug-reports/report-1']) {
    let continued = false; const headers = {};
    await readCacheMiddleware({method: 'GET', path}, {set: (key, value) => {headers[key] = value;}}, () => {continued = true;});
    assert.equal(headers['X-Cache'], 'BYPASS'); assert.equal(continued, true);
  }
});

test('board data, counts and custom columns stay inside the administrator organization', async () => {
  const e = setup({roles: ['administrator']});
  const res = await e.request('getBugReportBoard', {query: {organizationId: 'org-b', q: 'save'}});
  assert.equal(res.statusCode, 200); assert.equal(res.body.data.columns.length, 5);
  assert.equal(res.body.data.columns[2].id, 'custom-a'); assert.equal(res.body.data.total, 28);
  assert.equal(res.body.data.columns[0].total, 23); assert.equal(res.body.data.canCreateColumn, true);
  assert.equal(e.columnReads[0].where.organizationId, 'org-a');
  for (const query of e.reads) assert.equal(query.where.organizationId, 'org-a');
  assert.equal(e.reads.filter(query => !query.group).length, 2);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('custom column creation is role-gated, scoped and validates names and colors', async () => {
  const staff = setup();
  assert.equal((await staff.request('createBugReportColumn', {body: {name: 'Testing'}})).statusCode, 403);
  assert.equal((await staff.request('getBugReportBoard')).statusCode, 403);
  const e = setup({roles: ['administrator']});
  const res = await e.request('createBugReportColumn', {query: {organizationId: 'org-b'}, body: {name: ' Testing ', color: 'blue', createdBy: 'forged'}});
  assert.equal(res.statusCode, 201); assert.equal(e.columnWrites[0].name, 'Testing');
  assert.equal(e.columnWrites[0].organizationId, 'org-a'); assert.equal(e.columnWrites[0].createdBy, 'reporter-1');
  for (const body of [{name: ''}, {name: 'x'.repeat(61)}, {name: 'Testing', color: 'invalid'}]) assert.equal((await e.request('createBugReportColumn', {body})).statusCode, 400);
  for (const name of ['OPEN', 'Duplicate']) assert.equal((await e.request('createBugReportColumn', {body: {name}})).statusCode, 409);
});

test('superuser overview can combine boards but column creation requires a selected organization', async () => {
  const e = setup({roles: ['superuser']});
  const res = await e.request('getBugReportBoard');
  assert.equal(res.body.data.columns.length, 6); assert.equal(res.body.data.canCreateColumn, false);
  assert.equal((await e.request('createBugReportColumn', {body: {name: 'Testing'}})).statusCode, 400);
});

test('moves only accept a column belonging to the report, including for superusers', async () => {
  for (const roles of [['administrator'], ['superuser']]) {
    const e = setup({roles});
    assert.equal((await e.request('updateBugReport', {body: {status: 'custom-b'}})).statusCode, 400);
    assert.equal((await e.request('updateBugReport', {body: {status: 'custom-a', expectedStatus: 'open'}})).statusCode, 200);
    assert.equal(e.updates[0].query.where.status, 'open'); assert.equal(e.updates[0].payload.status, 'custom-a');
  }
});

test('stale or concurrent moves cannot silently overwrite another reviewer', async () => {
  const e = setup({roles: ['administrator']});
  assert.equal((await e.request('updateBugReport', {body: {status: 'resolved', expectedStatus: 'in_progress'}})).statusCode, 409);
  assert.equal(e.updates.length, 0);
  const racing = setup({roles: ['administrator'], updated: 0});
  assert.equal((await racing.request('updateBugReport', {body: {status: 'resolved', expectedStatus: 'open'}})).statusCode, 409);
  assert.equal(racing.updates[0].query.where.status, 'open');
});

test('custom column pagination rejects another organization’s status', async () => {
  const e = setup({roles: ['administrator']});
  assert.equal((await e.request('listBugReports', {query: {status: 'custom-b'}})).statusCode, 400);
  assert.equal(e.reads.length, 0);
  assert.equal((await e.request('listBugReports', {query: {status: 'custom-a', page: 2}})).statusCode, 200);
  assert.equal(e.reads[0].where.organizationId, 'org-a'); assert.equal(e.reads[0].where.status, 'custom-a'); assert.equal(e.reads[0].offset, 20);
});
