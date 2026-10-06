const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(relative, deps, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app', relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Error, Uint8Array,
    require: deps || (name => name.startsWith('.') ? load(path.join(path.dirname(relative), name + '.ts')) : require(name)), ...globals });
  return module.exports;
}
const { createAlphalistDraft, buildAlphalistDat, alphalistRecords } = load('core/bir-alphalist-dat.ts');
const report = { id: 'r1', year: 2026, quarter: 3, currency: 'PHP', organization: { id: 'org-a', legalName: 'EXAMPLE INC', taxId: '1234567890000', taxpayerClassification: 'corporation', rdoCode: '039' } };
const line = { reference: '00001', date: '2026-09-23', currency: 'PHP', status: 'approved', party: { legalName: 'CLIENT INC', taxId: '0010020030000', type: 'business' }, atc: 'WC160', rate: 2, incomePayment: 100, withheld: 2, nature: 'SERVICE INCOME' };
function draft(kind = 'expenses', lines = [line]) { const d = createAlphalistDraft(kind, report, lines); d.reviewed = true; d.scopeConfirmed = true; return d; }
function text(result) { return Buffer.from(result.bytes).toString('ascii'); }
test('QAP DAT uses exact 7/14/7 record widths, quarter period, branch and filename with CRLF and no BOM', () => {
  const result = buildAlphalistDat('expenses', report, draft());
  assert.equal(result.filename, '12345678900000920261601EQ.DAT');
  assert.equal(text(result), 'HQAP,H1601EQ,123456789,0000,EXAMPLE INC,09/2026,039\r\nD1,1601EQ,1,001002003,0000,CLIENT INC,,,,09/2026,WC160,2.00,100.00,2.00\r\nC1,1601EQ,123456789,0000,09/2026,100.00,2.00\r\n');
  assert.deepEqual(text(result).trim().split('\r\n').map(row => row.split(',').length), [7, 14, 7]);
  assert.equal(result.bytes[0], 72);
});
test('SAWT DAT matches the official 7.4 package generator including the seven-field control record', () => {
  const result = buildAlphalistDat('sales', report, draft('sales'));
  assert.equal(result.filename, '12345678900000920261702Q.DAT');
  assert.equal(text(result), 'HSAWT,H1702Q,123456789,0000,EXAMPLE INC,,,,09/2026,039\r\nDSAWT,D1702Q,1,001002003,0000,CLIENT INC,,,,09/2026,SERVICE INCOME,WC160,2.00,100.00,2.00\r\nCSAWT,C1702Q,123456789,0000,09/2026,100.00,2.00\r\n');
  assert.deepEqual(text(result).trim().split('\r\n').map(row => row.split(',').length), [10, 15, 7]);
});
test('grouping and control totals retain exact cents and keep branches and rates separate', () => {
  const d = draft('expenses', [line, { ...line, incomePayment: 0.1, withheld: 0.01 }, { ...line, incomePayment: 0.2, withheld: 0.01 }, { ...line, party: { ...line.party, taxId: '0010020030001' } }, { ...line, rate: 1 }]);
  const { records } = alphalistRecords('expenses', report, d);
  assert.equal(records.length, 5);
  assert.equal(records.at(-1).at(-2), '300.30'); assert.equal(records.at(-1).at(-1), '6.02');
  assert.ok(records.some(r => r[4] === '0000' && r.at(-2) === '100.30' && r.at(-1) === '2.02'));
  assert.ok(records.some(r => r[4] === '0001'));
});
test('SAWT ATC classification follows the income recipient, independently of the withholding agent type', () => {
  const d = draft('sales'); d.form = '1701Q'; d.filer.type = 'individual'; d.filer.lastName = 'SANTOS'; d.filer.firstName = 'MARIA'; d.lines[0].atc = 'WI160';
  assert.match(text(buildAlphalistDat('sales', report, d)), /CLIENT INC,,,,09\/2026,SERVICE INCOME,WI160/);
  d.lines[0].atc = 'WC160'; assert.throws(() => buildAlphalistDat('sales', report, d), /income recipient/);
});
test('individual names are separate and QAP header uses the reviewed full individual name', () => {
  const d = draft(); d.filer.type = 'individual'; d.filer.lastName = 'DELA CRUZ'; d.filer.firstName = 'JUAN'; d.filer.middleName = 'REYES';
  d.lines[0].identity.type = 'individual'; d.lines[0].identity.lastName = 'SANTOS'; d.lines[0].identity.firstName = 'MARIA'; d.lines[0].atc = 'WI160';
  const result = text(buildAlphalistDat('expenses', report, d));
  assert.match(result, /0000,DELA CRUZ JUAN REYES,09\/2026/); assert.match(result, /0000,,SANTOS,MARIA,,09\/2026,WI160/);
  assert.doesNotMatch(result, /CLIENT INC/);
});
test('validation blocks missing identities, wrong period, foreign currency, final ATCs and unsafe characters', () => {
  const cases = [
    [d => d.reviewed = false, /Confirm/], [d => d.scopeConfirmed = false, /Confirm/],
    [d => d.filer.branch = '', /branch code/], [d => d.filer.tin = '001002003x', /TIN/], [d => d.rdoCode = '39', /RDO/],
    [d => d.lines[0].identity.type = '', /taxpayer type/], [d => d.lines[0].identity.registeredName = 'A & B', /BIR-compatible/],
    [d => d.lines[0].identity.registeredName = 'MUÑOZ', /ASCII/], [d => d.lines[0].identity.registeredName = 'X'.repeat(51), /50/],
    [d => d.lines[0].atc = 'EWT2', /ATC/], [d => d.lines[0].atc = 'WC810', /creditable/], [d => d.lines[0].atc = 'WI160', /classification/],
    [d => d.lines[0].currency = 'USD', /PHP/], [d => d.lines[0].status = 'draft', /finalize/],
    [d => d.lines[0].date = '2026-06-30', /reporting quarter/], [d => d.lines[0].date = '2026-09-31', /reporting quarter/],
    [d => d.lines[0].incomePayment = -1, /positive/], [d => d.lines[0].withheld = 0, /positive/], [d => d.lines[0].rate = 100, /less than 100/],
    [d => d.lines[0].withheld = 101, /exceeds/], [d => d.lines[0].incomePayment = 100000000000, /11 integer/],
    [d => d.lines = [], /at least one/],
  ];
  for (const [change, expected] of cases) { const d = draft(); change(d); assert.throws(() => buildAlphalistDat('expenses', report, d), expected); }
});
test('current ATC patch creditable additions are accepted; annual and unsupported SAWT forms are blocked', () => {
  const d = draft(); d.lines[0].atc = 'WC850'; assert.match(text(buildAlphalistDat('expenses', report, d)), /WC850/);
  assert.throws(() => buildAlphalistDat('sales', { ...report, quarter: 4 }, draft('sales')), /Q4/);
  const bad = draft('sales'); bad.form = '1702'; assert.throws(() => buildAlphalistDat('sales', report, bad), /supported quarterly/);
  assert.throws(() => buildAlphalistDat('sales', { ...report, year: 2022 }, draft('sales')), /2023 onward/);
});
test('review component resets identities and confirmation on report change, guards duplicate downloads and exposes errors', async () => {
  const downloads = []; let failed = false;
  const { BirAlphalistExportComponent } = load('shared/bir-alphalist-export.component.ts', name => {
    if (name === '@angular/core') return { Component: () => target => target, Input: () => () => {}, ViewChild: () => () => {} };
    if (name === '../core/bir-alphalist-dat') return { createAlphalistDraft, BIR_ALPHALIST_VERSION: '7.4', BIR_FORMAT_VERIFIED_ON: '2026-10-06', downloadAlphalistDat: (...args) => { if (failed) throw new Error('Review needed'); downloads.push(args); }, downloadReviewedAlphalistExcel: (...args) => downloads.push(args) };
    return {};
  });
  const page = new BirAlphalistExportComponent(); page.report = report; page.lines = [line]; page.ngOnChanges();
  page.draft.reviewed = true; page.draft.scopeConfirmed = true;
  await Promise.all([page.download('dat'), page.download('dat')]); assert.equal(downloads.length, 1);
  page.changed(); assert.equal(page.draft.reviewed, false);
  page.draft.reviewed = true; failed = true; await page.download('dat'); assert.equal(page.error, 'Review needed'); assert.equal(page.exporting, false);
  page.ngOnChanges(); assert.equal(page.draft.reviewed, false); assert.equal(page.draft.scopeConfirmed, false); assert.equal(page.error, '');
  page.report = null; page.ngOnChanges(); await page.download('dat'); assert.equal(downloads.length, 1);
});
