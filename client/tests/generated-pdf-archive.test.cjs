const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { Subject } = require('rxjs');
function setup() {
  const requests = [], downloads = [], revoked = [], module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/shared/generated-pdf-archive.component.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, Blob,
    URL: { createObjectURL: () => 'blob:original-snapshot', revokeObjectURL: value => revoked.push(value) }, setTimeout: fn => fn(),
    document: { createElement() { const a = { click: () => downloads.push(a) }; return a; } },
    require: name => name === '@angular/core' ? { Component: () => value => value, Input: () => () => {}, signal: value => { const read = () => value; read.set = next => { value = next; }; return read; } } : {} });
  const request = url => { const stream = new Subject(); requests.push({ url, stream }); return stream; };
  const page = new module.exports.GeneratedPdfArchiveComponent({ list: request, download: request });
  page.year = 2026; page.organizationId = 'org-a';
  return { page, requests, downloads, revoked };
}
const row = { id: 'saved', title: 'BIR 2550Q', documentCode: '2550Q', organizationId: 'org-a', year: 2026, quarter: 3, filename: 'bir-2550Q-2026-q3.pdf', byteLength: 1200 };

test('archive lists all quarters only in the selected year and organization', () => {
  const f = setup(); f.page.ngOnChanges(); const params = new URL(f.requests[0].url, 'http://test').searchParams;
  assert.equal(params.get('year'), '2026'); assert.equal(params.get('organizationId'), 'org-a'); assert.equal(params.has('quarter'), false);
  f.requests[0].stream.next({ data: [row, { ...row, year: 2025 }, { ...row, organizationId: 'org-b' }], meta: { total: 1, totalPages: 1 } });
  assert.equal(f.page.rows().length, 1); assert.equal(f.page.rows()[0].documentCode, '2550Q');
});

test('switching year/org cancels stale reads and resets the table and pagination', () => {
  const f = setup(); f.page.ngOnChanges(); f.page.page = 3; f.page.year = 2025; f.page.ngOnChanges();
  assert.equal(f.requests[0].stream.observed, false); assert.equal(f.page.page, 1); assert.equal(f.page.rows().length, 0);
  f.requests[0].stream.next({ data: [row] }); assert.equal(f.page.rows().length, 0);
  assert.match(f.requests[1].url, /year=2025/); f.page.organizationId = ''; f.page.ngOnChanges(); assert.equal(f.requests.length, 2); assert.equal(f.page.loading(), false);
});

test('saved download fetches the original authenticated file, never calls the generator and releases the blob URL', () => {
  const f = setup(); f.page.download(row); f.page.download(row);
  assert.equal(f.requests.length, 1); assert.match(f.requests[0].url, /\/documents\/saved\/pdf\?organizationId=org-a/);
  f.requests[0].stream.next(new Blob(['%PDF-original'])); assert.equal(f.downloads[0].download, row.filename); assert.equal(f.revoked[0], 'blob:original-snapshot'); assert.equal(f.page.downloading(), '');
  f.page.download({ ...row, year: 2025 }); assert.equal(f.requests.length, 1);
});

test('download errors are readable and retryable; changing organization cancels pending files', async () => {
  const f = setup(); f.page.download(row); f.requests[0].stream.error({ error: new Blob([JSON.stringify({ message: 'Saved PDF not found.' })]) });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.page.downloadError(), 'Saved PDF not found.'); assert.equal(f.page.downloading(), '');
  f.page.download(row); assert.equal(f.requests.length, 2); f.page.organizationId = 'org-b'; f.page.ngOnChanges(); assert.equal(f.requests[1].stream.observed, false);
  f.requests[1].stream.next(new Blob(['%PDF-old'])); assert.equal(f.downloads.length, 0); f.page.ngOnDestroy();
});

test('pagination and refresh retain the year/org and destroyed components unsubscribe', () => {
  const f = setup(); f.page.ngOnChanges(); f.requests[0].stream.next({ data: [row], meta: { total: 25, totalPages: 2 } });
  f.page.changePage(2); assert.match(f.requests[1].url, /page=2/); assert.match(f.requests[1].url, /year=2026/);
  f.page.refreshVersion++; f.page.ngOnChanges(); assert.equal(f.page.page, 1); assert.equal(f.requests[1].stream.observed, false);
  f.page.ngOnDestroy(); assert.equal(f.requests[2].stream.observed, false);
});
