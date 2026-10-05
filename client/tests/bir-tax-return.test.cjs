const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Subject } = require('rxjs');

function setup() {
  const requests = [], revoked = [], downloads = [], opened = [], saved = [];
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/shared/bir-tax-return.component.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URLSearchParams, Blob,
    URL: { createObjectURL: () => 'blob:generated-pdf', revokeObjectURL: value => revoked.push(value) },
    document: { createElement() { const link = { click: () => downloads.push(link) }; return link; } },
    window: { open: (...args) => opened.push(args) },
    require(name) {
      if (name === '@angular/core') return {
        Component: () => value => value, Input: () => () => {}, Output: () => () => {}, ViewChild: () => () => {}, EventEmitter: class { emit() { saved.push(true); } },
        signal(value) { const read = () => value; read.set = next => { value = next; }; return read; },
      };
      return new Proxy({}, { get: (_target, key) => key });
    },
  });
  const api = { generatePdf(url, payload) { const stream = new Subject(); requests.push({ url, payload, stream }); return stream; } };
  const page = new module.exports.BirTaxReturnComponent(api, { bypassSecurityTrustResourceUrl: value => value });
  page.preparation = { supported: true, form: '2551Q', year: 2026, quarter: 3, sourceRevision: 'revision-a', defaults: { rdoCode: '039', percentageSales: 100000 } };
  page.organizationId = 'org-a'; page.canGenerate = true; page.ngOnChanges();
  return { page, requests, revoked, downloads, opened, saved };
}

test('generation previews an authenticated PDF and downloads the selected form and quarter', () => {
  const { page, requests, downloads, saved } = setup();
  page.generate();
  assert.equal(page.generating(), true);
  assert.equal(requests[0].payload.quarter, 3);
  assert.equal(requests[0].payload.sourceRevision, 'revision-a');
  assert.equal(new URL(requests[0].url, 'http://test').searchParams.get('organizationId'), 'org-a');
  requests[0].stream.next(new Blob(['%PDF-'])); requests[0].stream.complete();
  assert.equal(page.generating(), false); assert.equal(page.preview(), 'blob:generated-pdf');
  assert.equal(saved.length, 1);
  page.download(); assert.equal(downloads[0].download, 'bir-2551Q-2026-q3.pdf');
});

test('changing details clears the old PDF so print and download cannot use stale values', () => {
  const { page, requests, revoked, downloads } = setup();
  page.generate(); requests[0].stream.next(new Blob(['%PDF-']));
  page.update('percentageSales', 200000);
  assert.equal(page.preview(), null); assert.equal(page.loaded(), false);
  assert.equal(revoked.join(','), 'blob:generated-pdf');
  page.download(); assert.equal(downloads.length, 0);
  page.generate(); assert.equal(requests[1].payload.details.percentageSales, 200000);
});

test('switching quarter cancels in-flight PDF generation and resets filing details', () => {
  const { page, requests } = setup(); page.generate();
  page.preparation = { ...page.preparation, quarter: 4, defaults: { rdoCode: '', percentageSales: 500 } };
  page.ngOnChanges();
  assert.equal(requests[0].stream.observed, false); assert.equal(page.generating(), false);
  requests[0].stream.next(new Blob(['%PDF-'])); assert.equal(page.preview(), null);
  assert.equal(page.details.rdoCode, '');
  page.generate(); assert.equal(requests[1].payload.quarter, 4);
  page.ngOnDestroy(); assert.equal(requests[1].stream.observed, false);
});

test('PDF errors decode blob responses and do not overwrite a changed quarter', async () => {
  const { page, requests } = setup(); page.generate();
  requests[0].stream.error({ error: new Blob([JSON.stringify({ message: 'RDO is required.' })]) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.error(), 'RDO is required.');
  page.generate(); requests[1].stream.error({ error: new Blob([JSON.stringify({ message: 'Old error' })]) });
  page.ngOnChanges(); await new Promise(resolve => setImmediate(resolve)); assert.equal(page.error(), '');
});

test('printing invokes the preview frame and opening uses a separate PDF tab', () => {
  const { page, requests, opened } = setup(); let printed = 0;
  page.generate(); requests[0].stream.next(new Blob(['%PDF-']));
  page.pdfFrame = { nativeElement: { contentWindow: { focus() {}, print() { printed++; } } } };
  page.print(); assert.equal(printed, 1); page.open(); assert.equal(opened[0][0], 'blob:generated-pdf');
});

test('unsupported organizations and users without generation permission cannot request PDFs', () => {
  const { page, requests } = setup(); page.canGenerate = false; page.generate();
  page.canGenerate = true; page.preparation.supported = false; page.generate(); assert.equal(requests.length, 0);
});
