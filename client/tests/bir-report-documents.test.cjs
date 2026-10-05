const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject } = require('rxjs');

function setup() {
  const requests = [], revoked = [], downloads = [], opened = [];
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/shared/bir-report-documents.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URLSearchParams, Blob,
    URL: { createObjectURL: () => 'blob:report', revokeObjectURL: value => revoked.push(value) },
    document: { createElement() { const link = { click: () => downloads.push(link) }; return link; } },
    window: { open: (...args) => opened.push(args) },
    require(name) {
      if (name === '@angular/core') return {
        Component: () => value => value, Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {}, EventEmitter: class { emit() {} },
        signal(value) { const read = () => value; read.set = next => { value = next; }; return read; },
      };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const api = { generatePdf(url, payload) { const stream = new Subject(); requests.push({ url, payload, stream }); return stream; } };
  const page = new module.exports.BirReportDocumentsComponent(api, { bypassSecurityTrustResourceUrl: value => value });
  const document = { id: '1702Q', supported: true, year: 2026, quarter: 3, annual: false, category: 'Income tax returns', sourceRevision: 'r1', fields: [{ key: 'reviewedAmounts', type: 'checkbox' }], defaults: { sales: 100000, reviewedAmounts: false } };
  page.documents = [document, { ...document, id: 'SAWT', category: 'Supporting schedules', fields: [], defaults: {} }, { ...document, id: '1701Q', supported: false }];
  page.organizationId = 'org-a'; page.canGenerate = true; page.ngOnChanges(); page.select('1702Q');
  return { page, requests, revoked, downloads, opened };
}

test('selected document generates an authenticated PDF with the selected quarter and source revision', () => {
  const { page, requests, downloads } = setup(); page.generate();
  assert.equal(requests[0].payload.documentId, '1702Q'); assert.equal(requests[0].payload.quarter, 3);
  assert.equal(requests[0].payload.sourceRevision, 'r1');
  assert.equal(new URL(requests[0].url, 'http://test').searchParams.get('organizationId'), 'org-a');
  requests[0].stream.next(new Blob(['%PDF-'])); requests[0].stream.complete();
  assert.equal(page.preview(), 'blob:report'); page.download(); assert.equal(downloads[0].download, 'bir-1702Q-2026-q3.pdf');
});

test('a saved report can open its matching document when the workspace is recreated', () => {
  const { page, requests } = setup();
  page.initialDocumentId = 'SAWT';
  page.ngOnChanges({ initialDocumentId: { currentValue: 'SAWT', firstChange: true } });
  assert.equal(page.selectedId, 'SAWT');
  page.generate();
  assert.equal(requests[0].payload.documentId, 'SAWT');
});

test('switching documents clears the PDF, cancels the old request and resets details', () => {
  const { page, requests, revoked, downloads } = setup(); page.generate(); requests[0].stream.next(new Blob(['%PDF-']));
  page.select('SAWT'); assert.equal(page.preview(), null); assert.equal(revoked.length, 1);
  assert.equal(requests[0].stream.observed, false); assert.equal(Object.keys(page.details).length, 0);
  page.download(); assert.equal(downloads.length, 0); page.generate(); assert.equal(requests[1].payload.documentId, 'SAWT');
  page.select('business'); assert.equal(requests[1].stream.observed, false); assert.equal(page.generating(), false);
});

test('changing quarter or organization invalidates requests, preview and download', () => {
  const { page, requests, downloads } = setup(); page.generate();
  page.documents = page.documents.map(doc => ({ ...doc, quarter: 2, sourceRevision: 'r2' })); page.organizationId = 'org-b'; page.ngOnChanges();
  assert.equal(requests[0].stream.observed, false); requests[0].stream.next(new Blob(['old'])); assert.equal(page.preview(), null);
  page.download(); assert.equal(downloads.length, 0); page.generate();
  assert.equal(requests[1].payload.quarter, 2); assert.equal(requests[1].payload.sourceRevision, 'r2');
  assert.equal(new URL(requests[1].url, 'http://test').searchParams.get('organizationId'), 'org-b');
});

test('unsupported forms, missing scope and read-only users cannot generate', () => {
  const { page, requests } = setup(); page.select('1701Q'); page.generate(); assert.equal(requests.length, 0);
  page.select('1702Q'); page.canGenerate = false; page.generate(); assert.equal(requests.length, 0);
  page.canGenerate = true; page.organizationId = ''; page.generate(); assert.equal(requests.length, 0);
});

test('editing amounts resets review confirmation and selecting a recipient fills that supplier’s details', () => {
  const { page } = setup(); page.details.reviewedAmounts = true; page.update('sales', 200000); assert.equal(page.details.reviewedAmounts, false);
  page.details.reviewedAmounts = true; page.update('verifiedCredits', true); assert.equal(page.details.reviewedAmounts, true);
  page.update('currentWithholding', 200); assert.equal(page.details.reviewedAmounts, false); assert.equal(page.details.verifiedCredits, false);
  page.documents.push({ id: '2307', fields: [{ key: 'reviewedAmounts', type: 'checkbox' }], defaults: {}, recipients: [{ key: 'supplier-b', name: 'SUPPLIER B', tin: '12345678900000', address: 'MANILA', zip: '1000' }] });
  page.select('2307'); page.update('recipientKey', 'supplier-b');
  assert.equal(page.details.payeeName, 'SUPPLIER B'); assert.equal(page.details.payeeTin, '12345678900000'); assert.equal(page.details.payeeAddress, 'MANILA');
});

test('blob errors from an older document cannot overwrite the current selection', async () => {
  const { page, requests } = setup(); page.generate();
  requests[0].stream.error({ error: new Blob([JSON.stringify({ message: 'Old error' })]) });
  page.select('SAWT'); await new Promise(resolve => setImmediate(resolve)); assert.equal(page.error(), '');
  page.generate(); requests[1].stream.error({ error: new Blob([JSON.stringify({ message: 'Records changed' })]) });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(page.error(), 'Records changed');
});

test('PDF print/open and disposal use only the current local preview', () => {
  const { page, requests, opened, revoked } = setup(); let printed = 0;
  page.generate(); requests[0].stream.next(new Blob(['%PDF-']));
  page.pdfFrame = { nativeElement: { contentWindow: { focus() {}, print() { printed++; } } } };
  page.print(); assert.equal(printed, 1); page.open(); assert.equal(opened[0][0], 'blob:report');
  page.ngOnDestroy(); assert.equal(page.preview(), null); assert.equal(revoked.length, 1); assert.equal(requests[0].stream.observed, false);
});
