const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
const { File } = require('node:buffer');
function setup() {
  const requests = [], discarded = [], changes = [];
  const api = { uploadFormData(url, body) { const stream = new rx.Subject(); requests.push({ url, body, stream }); return stream; }, remove(url, id) { discarded.push(id); return rx.of({}); } };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/order-workspace-page/proof-upload/order-proof-upload.component.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, FormData, crypto: require('node:crypto').webcrypto, require(name) {
    if (name === '@angular/core') return { Component: () => value => value, Input: () => () => {}, Output: () => () => {}, EventEmitter: class extends rx.Subject { emit(v) { this.next(v); } }, inject: () => api };
    if (name === '@angular/common/http') return { HttpEventType: { UploadProgress: 1, Response: 4 } };
    return {};
  } });
  const page = new module.exports.OrderProofUploadComponent(); page.organizationId = 'org-a'; page.uploadsChange.subscribe(value => changes.push(value));
  const complete = (index = 0) => { const r = requests[index]; r.stream.next({ type: 4, body: { data: { id: r.body.get('uploadId') } } }); r.stream.complete(); };
  return { page, requests, discarded, changes, complete };
}
const file = (name = 'proof.pdf') => new File(['%PDF-1.7\nproof'], name, { type: 'application/pdf', lastModified: 1 });
test('drop starts separate uploads immediately, caps concurrency at two and reports real individual progress', () => {
  const e = setup(); let prevented = false;
  e.page.drop({ preventDefault() { prevented = true; }, stopPropagation() {}, dataTransfer: { files: [file('one.pdf'), file('two.pdf'), file('three.pdf')] } });
  assert.equal(prevented, true); assert.equal(e.requests.length, 2); assert.equal(e.page.uploads[2].status, 'queued');
  e.requests[0].stream.next({ type: 1, loaded: 25, total: 100 }); assert.equal(e.page.uploads[0].progress, 25); assert.equal(e.page.uploads[1].progress, 0);
  e.requests[0].stream.next({ type: 1, loaded: 100, total: 100 }); assert.equal(e.page.uploads[0].status, 'processing'); assert.equal(e.page.uploads[0].progress, 99);
  e.complete(); assert.equal(e.page.uploads[0].progress, 100); assert.equal(e.page.uploads[0].status, 'uploaded'); assert.equal(e.requests.length, 3);
  e.complete(1); e.complete(2); assert.ok(e.changes.at(-1).every(entry => entry.status === 'uploaded'));
});
test('browse supports multiple files and unknown lengths use indeterminate progress', () => {
  const e = setup(); const target = { value: 'chosen', files: [file(), file('photo.png')] }; e.page.select({ target }); assert.equal(target.value, ''); assert.equal(e.requests.length, 2);
  e.requests[0].stream.next({ type: 1, loaded: 20 }); assert.equal(e.page.uploads[0].progress, null); assert.equal(e.page.statusLabel(e.page.uploads[0]), 'Uploading…');
});
test('failed uploads can retry independently with the same ID without resending successful files', () => {
  const e = setup(); e.page.addFiles([file('one.pdf'), file('two.pdf')]); e.complete();
  e.requests[1].stream.error({ error: { message: 'Offline' } }); const failed = e.page.uploads[1]; assert.equal(failed.status, 'error');
  e.page.retry(failed); assert.equal(e.requests.length, 3); assert.equal(e.requests[1].body.get('uploadId'), e.requests[2].body.get('uploadId')); assert.equal(e.page.uploads[0].status, 'uploaded');
});
test('remove cancels an in-flight request, discards its temporary file and starts the next queued file', () => {
  const e = setup(); e.page.addFiles([file('one.pdf'), file('two.pdf'), file('three.pdf')]); const first = e.page.uploads[0]; e.page.remove(first);
  assert.equal(e.requests[0].stream.observers.length, 0); assert.equal(e.discarded[0], first.id); assert.equal(e.requests.length, 3); assert.equal(e.page.uploads.length, 2);
});
test('invalid files get individual errors and duplicates or excess files do not upload', () => {
  const e = setup(); e.page.addFiles([file('bad.html'), { name: 'empty.pdf', size: 0 }, { name: 'big.pdf', size: 5242881 }, file()]);
  assert.equal(e.requests.length, 1); assert.equal(e.page.uploads.filter(v => v.status === 'error').length, 3);
  e.page.addFiles([file()]); assert.equal(e.page.uploads.length, 4);
  e.page.addFiles(Array.from({ length: 12 }, (_, i) => file(`extra${i}.pdf`))); assert.equal(e.page.uploads.length, 10); assert.match(e.page.notice, /10 files/);
});
test('switching organizations cancels requests and clears files; successful saves retain attached documents', () => {
  const e = setup(); e.page.addFiles([file()]); const id = e.page.uploads[0].id; e.page.organizationId = 'org-b'; e.page.ngOnChanges({ organizationId: {} });
  assert.equal(e.requests[0].stream.observers.length, 0); assert.equal(e.page.uploads.length, 0); assert.equal(e.discarded[0], id);
  e.page.addFiles([file()]); e.complete(1); e.page.markSaved(); e.page.ngOnDestroy(); assert.equal(e.discarded.length, 1);
});
test('disabled dropzones do not upload, remove or retry files', () => {
  const e = setup(); e.page.disabled = true; e.page.addFiles([file()]); assert.equal(e.requests.length, 0);
  e.page.disabled = false; e.page.addFiles([file()]); e.page.disabled = true; e.page.remove(e.page.uploads[0]); assert.equal(e.discarded.length, 0);
});
test('HTTP completion without a confirmed upload never shows success', () => {
  const e = setup(); e.page.addFiles([file()]); e.requests[0].stream.complete(); assert.equal(e.page.uploads[0].status, 'error');
});
