const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { archiveReportPdf, REPORT_DOCUMENT_METADATA } = require('../src/services/report-document-archive');
const { authorize } = require('../src/middleware/authz');
const crypto = require('node:crypto');

function setup({ superuser = false, missing = false } = {}) {
  const calls = [], bytes = Buffer.from('%PDF-original-2550Q-snapshot');
  const models = missing ? {} : { ReportDocument: {
    findAndCountAll: async options => { calls.push(options); return { rows: [], count: 25 }; },
    findOne: async options => { calls.push(options); return options.where.organizationId === 'org-a' && options.where.id === 'saved' ? { filename: 'bir-2550Q-2026-q3.pdf', pdfContent: bytes } : null; },
  } };
  const filename = require.resolve('../src/controllers/report-documents-controller'), actual = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer,
    require: name => name === '../sequelize' ? { getModels: () => models } : actual(name) });
  const req = { query: { year: '2026', organizationId: 'org-b' }, params: { id: 'saved' },
    auth: { user: { organizationId: 'org-a' }, roleCodes: superuser ? ['superuser'] : ['accountant'], permissions: new Set(['reports.read']) } };
  const res = { headers: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; return this; } };
  return { calls, bytes, models, req, res, controller: module.exports };
}
const next = error => { throw error; };

test('archive listing uses the selected year and authenticated organization and never includes PDF content', async () => {
  const f = setup(); await f.controller.listReportDocuments(f.req, f.res, next);
  assert.equal(f.res.statusCode, 200); assert.equal(f.calls[0].where.organizationId, 'org-a'); assert.equal(f.calls[0].where.year, 2026);
  assert.equal(f.calls[0].where.quarter, undefined); assert.ok(!f.calls[0].attributes.includes('pdfContent'));
  assert.equal(f.res.body.meta.totalPages, 2); assert.equal(f.res.headers['Cache-Control'], 'private, no-store');
});

test('superuser archive retrieval requires explicit organization selection and follows it', async () => {
  const f = setup({ superuser: true }); delete f.req.query.organizationId;
  await f.controller.listReportDocuments(f.req, f.res, next); assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
  f.req.query.organizationId = 'org-b'; await f.controller.listReportDocuments(f.req, f.res, next); assert.equal(f.calls[0].where.organizationId, 'org-b');
  await f.controller.downloadReportDocument(f.req, f.res, next); assert.equal(f.res.statusCode, 404);
});

test('download returns the original bytes and cannot retrieve another organization PDF by spoofing scope', async () => {
  const f = setup(); await f.controller.downloadReportDocument(f.req, f.res, next);
  assert.equal(f.res.statusCode, 200); assert.deepEqual(f.res.body, f.bytes);
  assert.equal(f.res.headers['Content-Type'], 'application/pdf'); assert.match(f.res.headers['Content-Disposition'], /^attachment; filename="bir-2550Q/);
  assert.equal(f.calls[0].where.organizationId, 'org-a');
  f.req.auth.user.organizationId = 'org-b'; await f.controller.downloadReportDocument(f.req, f.res, next); assert.equal(f.res.statusCode, 404);
});

test('missing year, invalid pagination and missing storage fail with clear responses before a query', async () => {
  for (const query of [{ year: undefined }, { year: 2026.5 }, { year: 2026, limit: 101 }, { year: 2026, page: -1 }]) {
    const f = setup(); f.req.query = query; await f.controller.listReportDocuments(f.req, f.res, next); assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
  }
  const f = setup({ missing: true }); await f.controller.listReportDocuments(f.req, f.res, next); assert.equal(f.res.statusCode, 503);
});

test('every generation stores a separate durable snapshot, filename, size and hash', async () => {
  const saved = []; const models = { ReportDocument: { create: async data => { saved.push(data); return { id: String(saved.length) }; } } };
  const input = { organizationId: 'org-a', code: '2550Q', title: 'BIR 2550Q', year: 2026, quarter: 3, sourceRevision: 'revision', generatedBy: 'actor', bytes: Buffer.from('%PDF-version-1') };
  await archiveReportPdf(models, input); await archiveReportPdf(models, { ...input, bytes: Buffer.from('%PDF-version-2') });
  assert.equal(saved.length, 2); assert.equal(saved[0].filename, 'bir-2550Q-2026-q3.pdf'); assert.equal(saved[0].byteLength, input.bytes.length);
  assert.equal(saved[0].sha256, crypto.createHash('sha256').update(input.bytes).digest('hex')); assert.deepEqual(saved[0].pdfContent, input.bytes);
  assert.notDeepEqual(saved[0].pdfContent, saved[1].pdfContent); assert.equal(saved[0].generatedBy, 'actor');
  assert.ok(!REPORT_DOCUMENT_METADATA.includes('pdfContent'));
});

test('a PDF storage failure is reported instead of returning an unsaved preview', async () => {
  const input = { organizationId: 'org-a', code: 'SALES', title: 'Sales', year: 2026, quarter: 3, sourceRevision: 'r', bytes: Buffer.from('%PDF-valid') };
  await assert.rejects(archiveReportPdf({}, input), error => error.status === 503);
  await assert.rejects(archiveReportPdf({ ReportDocument: {} }, { ...input, bytes: Buffer.from('invalid') }), error => error.status === 500);
});

test('read-only accountant can retrieve saved PDFs; users without report read cannot access the table or files', () => {
  const f = setup(); let allowed = false; authorize('reports.read')(f.req, f.res, () => { allowed = true; }); assert.equal(allowed, true);
  f.req.auth.permissions = new Set(); allowed = false; authorize('reports.read')(f.req, f.res, () => { allowed = true; }); assert.equal(allowed, false); assert.equal(f.res.statusCode, 403);
});
