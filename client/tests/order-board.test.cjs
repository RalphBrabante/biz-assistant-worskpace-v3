const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
function setup(permissions = ['orders.update', 'orders.approve']) {
  const requests = [];
  const deps = { ApiService: {
    getFresh(url) { const stream = new rx.Subject(); requests.push({ url, stream }); return stream; },
    create(url, payload) { const stream = new rx.Subject(); requests.push({ url, payload, stream }); return stream; },
  }, AuthService: { hasPermission: code => permissions.includes(code) } };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/orders-page/board/order-board.component.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const decorator = () => () => {};
  vm.runInNewContext(source, { module, exports: module.exports, URLSearchParams, console, require(name) {
    if (name === 'rxjs') return rx;
    if (name === '@angular/core') return { Component: () => value => value, Input: decorator, Output: decorator, HostListener: decorator, EventEmitter: class extends rx.Subject { emit(value) { this.next(value); } }, inject: key => deps[key] };
    return new Proxy({}, { get: (_, key) => key });
  } });
  const page = new module.exports.OrderBoardComponent(); page.organizationId = 'org-a';
  const order = { id: 'order-1', orderNumber: 'SO-TEST', status: 'draft', revision: 3, workflow: { approval: 'not_required' }, paymentStatus: 'unpaid', fulfillmentStatus: 'unfulfilled' };
  function resolve(rows = [order], total = rows.length) {
    for (const request of requests.filter(r => !r.payload && r.stream.observers.length)) {
      const status = new URL(request.url, 'http://test').searchParams.get('status');
      const matches = rows.filter(row => row.status === status); request.stream.next({ data: matches, meta: { total: matches.length ? total : 0 } }); request.stream.complete();
    }
  }
  return { page, requests, order, resolve };
}
function loaded(permissions) { const e = setup(permissions); e.page.load(); e.resolve(); return e; }
const dragEvent = () => ({ preventDefault() {}, currentTarget: { contains() { return false; } }, dataTransfer: { setData() {} } });
test('columns query scoped, filtered pages independently instead of splitting one paginated list', () => {
  const e = setup(); e.page.search = 'PO123'; e.page.payment = 'partially_paid'; e.page.queue = 'ready_to_invoice'; e.page.load();
  assert.equal(e.requests.length, 7);
  for (const r of e.requests) { const p = new URL(r.url, 'http://test').searchParams; assert.equal(p.get('organizationId'), 'org-a'); assert.equal(p.get('limit'), '20'); assert.equal(p.get('q'), 'PO123'); assert.equal(p.get('paymentStatus'), 'partially_paid'); assert.equal(p.get('view'), 'ready_to_invoice'); }
  e.resolve([e.order], 47); assert.equal(e.page.columns[0].total, 47); assert.equal(e.page.columns[0].rows.length, 1);
  e.page.more(e.page.columns[0]); assert.equal(new URL(e.requests.at(-1).url, 'http://test').searchParams.get('page'), '2');
});
test('filter changes cancel stale column reads and reset pagination', () => {
  const e = setup(); e.page.load(); e.page.organizationId = 'org-b'; e.page.ngOnChanges();
  assert.equal(e.requests[0].stream.observers.length, 0); assert.equal(new URL(e.requests[7].url, 'http://test').searchParams.get('organizationId'), 'org-b');
  e.page.ngOnDestroy(); assert.equal(e.requests[7].stream.observers.length, 0);
});
test('dragging runs a revision-checked action and keeps the card in place until committed', () => {
  const e = loaded(), column = e.page.columns.find(c => c.id === 'confirmed'); const event = dragEvent();
  e.page.startDrag(event, e.order); e.page.dragOver(event, column); assert.equal(e.page.dropTarget, 'confirmed'); e.page.drop(event, column);
  assert.equal(e.requests.at(-1).payload.action, 'confirm'); assert.equal(e.requests.at(-1).payload.revision, 3);
  assert.equal(e.page.columns[0].rows[0].id, e.order.id); assert.equal(column.rows.length, 0);
  e.page.move(e.order, 'confirmed'); assert.equal(e.requests.filter(r => r.payload).length, 1);
  e.requests.at(-1).stream.error({ status: 400, error: { message: 'Verified purchase order required' } });
  assert.equal(e.page.movingId, ''); assert.match(e.page.error, /purchase order/); assert.equal(e.page.columns[0].rows[0].id, e.order.id);
});
test('cancellation drag opens a reason dialog without sending a write', () => {
  const e = loaded(); const event = dragEvent(); e.page.startDrag(event, e.order); e.page.drop(event, e.page.columns.find(c => c.id === 'cancelled'));
  assert.equal(e.requests.length, 7); assert.equal(e.page.targetStatus, 'cancelled'); e.page.saveMove(); assert.match(e.page.error, /reason/); assert.equal(e.requests.length, 7);
  e.page.reason = 'Customer withdrew'; e.page.saveMove(); assert.equal(e.requests.at(-1).payload.note, 'Customer withdrew'); assert.equal(e.requests.at(-1).payload.action, 'cancel');
  e.page.close(); assert.ok(e.page.selected);
});
test('keyboard/touch move uses the same action path as dragging', () => {
  const e = loaded(); e.page.openMove(e.order); e.page.targetStatus = 'pending'; e.page.saveMove(); assert.equal(e.requests.at(-1).payload.action, 'submit');
  e.requests.at(-1).stream.next({ data: { ...e.order, status: 'pending' } }); assert.equal(e.page.selected, null); assert.match(e.page.notice, /Pending approval/); assert.equal(e.requests.length, 15);
});
test('read-only, legacy and terminal orders cannot be dragged or updated', () => {
  const e = loaded([]); e.page.move(e.order, 'confirmed'); assert.equal(e.requests.length, 7);
  const writable = loaded(); for (const order of [{ ...e.order, workflow: null }, { ...e.order, status: 'completed' }, { ...e.order, status: 'cancelled' }]) { assert.equal(writable.page.movable(order), false); writable.page.move(order, 'draft'); }
  writable.page.move(writable.order, 'completed'); writable.page.move(writable.order, 'refunded'); assert.equal(writable.requests.length, 7);
});
test('stale revisions refresh the board without replaying the action', () => {
  const e = loaded(); e.page.move(e.order, 'confirmed'); e.requests.at(-1).stream.error({ status: 409, error: { message: 'Order changed. Reload.' } });
  assert.equal(e.requests.length, 15); assert.match(e.page.error, /changed/); assert.equal(e.requests.filter(r => r.payload).length, 1);
});
test('processing starts work without recording fulfillment or payment fields', () => {
  const e = loaded(); const order = { ...e.order, status: 'confirmed' }; e.page.move(order, 'processing');
  const payload = e.requests.at(-1).payload; assert.equal(payload.action, 'start_processing'); assert.equal(payload.lines, undefined); assert.equal(payload.paymentStatus, undefined);
});
test('approval is a separate permission and does not move the order into confirmed', () => {
  const e = loaded(['orders.update']); const order = { ...e.order, status: 'pending', workflow: { approval: 'pending' } }; e.page.approve(order); assert.equal(e.requests.length, 7);
  const reviewer = loaded(['orders.approve']); reviewer.page.approve(order); assert.equal(reviewer.requests.at(-1).payload.action, 'approve');
});
test('column errors are retryable and one failed column does not erase other orders', () => {
  const e = setup(); e.page.load(); e.requests[0].stream.next({ data: [e.order], meta: { total: 1 } }); e.requests[0].stream.complete(); e.requests[1].stream.error({});
  assert.equal(e.page.columns[0].rows.length, 1); assert.match(e.page.columns[1].error, /Unable/); e.page.retry(e.page.columns[1]); assert.equal(new URL(e.requests.at(-1).url, 'http://test').searchParams.get('page'), '1');
});
