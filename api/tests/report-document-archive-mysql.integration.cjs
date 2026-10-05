const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { PDFDocument } = require('pdf-lib');
const { reportArchiveFixture } = require('./helpers/report-archive-mysql.cjs');
const { prepareTaxReturn } = require('../src/services/bir-tax-return');

function controller(name, models) {
  const filename = require.resolve(`../src/controllers/${name}`), actual = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer,
    require: name => name === '../sequelize' ? { getModels: () => models } : name === '../services/email-service' ? {} : actual(name) });
  return module.exports;
}
function response() { return { headers: {}, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, set(key, value) { this.headers[key] = value; return this; } }; }
const next = error => { throw error; };

test('generated 2550Q PDF survives refresh, downloads byte-for-byte, keeps revisions/year/tenant private, and migration rolls back', {
  skip: process.env.RUN_REPORT_ARCHIVE_MYSQL_INTEGRATION !== '1', timeout: 60000,
}, async () => {
  const f = await reportArchiveFixture();
  try {
    const reports = controller('reports-controller', f.models), archive = controller('report-documents-controller', f.models);
    const auth = { userId: f.actorId, user: { id: f.actorId, organizationId: f.organization.id }, roleCodes: ['accountant'] };
    const req = { auth, query: { organizationId: f.otherOrganizationId }, params: {} };
    async function generate(year) {
      const prep = prepareTaxReturn(f.organization, [], [], year, 3), res = response();
      await reports.generateBirTaxReturnPdf({ ...req, body: { year, quarter: 3, sourceRevision: prep.sourceRevision, details: { ...prep.defaults, rdoCode: '039', taxpayerSize: 'small', incomeTaxElection: 'graduated' } } }, res, next);
      assert.equal(res.statusCode, 200, res.body?.message); assert.ok(Buffer.isBuffer(res.body)); return res.body;
    }
    const original = await generate(2026), pdf = await PDFDocument.load(original);
    assert.equal(pdf.getTitle(), 'BIR 2550Q Q3 2026');
    f.organization.legalName = 'Changed name after first generation';
    const revised = await generate(2026); assert.notDeepEqual(revised, original);
    await generate(2025);
    const list = response(); await archive.listReportDocuments({ ...req, query: { ...req.query, year: 2026 } }, list, next);
    assert.equal(list.body.meta.total, 2); assert.ok(list.body.data.every(row => row.year === 2026));
    assert.ok(!JSON.stringify(list.body).includes('pdfContent'));
    const saved = await f.models.ReportDocument.findAll({ order: [['generatedAt', 'ASC']] });
    const first = saved.find(row => Buffer.from(row.pdfContent).equals(original)); assert.ok(first);
    const downloaded = response(); await archive.downloadReportDocument({ ...req, params: { id: first.id } }, downloaded, next);
    assert.equal(downloaded.statusCode, 200); assert.deepEqual(downloaded.body, original);
    const denied = response(); await archive.downloadReportDocument({ ...req, auth: { ...auth, user: { organizationId: f.otherOrganizationId } }, params: { id: first.id } }, denied, next);
    assert.equal(denied.statusCode, 404);
    const historic = response(); await archive.listReportDocuments({ ...req, query: { year: 2025 } }, historic, next); assert.equal(historic.body.meta.total, 1);
    await f.migration.down(f.db.getQueryInterface()); const tables = await f.db.getQueryInterface().showAllTables(); assert.ok(!tables.includes('report_documents'));
  } finally { await f.close(); }
});
