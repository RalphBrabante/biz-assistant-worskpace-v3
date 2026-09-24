const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rx = require('rxjs');
function setup(permissions = ['orders.update', 'orders.approve'], storage = new Map()) {
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const preferences = { exports: {} };
  const preferenceSource = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/core/table-preferences.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(preferenceSource, { module: preferences, exports: preferences.exports, localStorage });
  const requests = [];
  const deps = { ApiService: {
    getFresh(url) { const stream = new rx.Subject(); requests.push({ url, stream }); return stream; },
    create(url, payload) { const stream = new rx.Subject(); requests.push({ url, payload, stream }); return stream; },
  }, AuthService: { hasPermission: code => permissions.includes(code), currentUser: () => ({ id: 'user-a' }) } };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/app/pages/orders-page/board/order-board.component.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const decorator = () => () => {};
  vm.runInNewContext(source, { module, exports: module.exports, URLSearchParams, console, require(name) {
    if (name === 'rxjs') return rx;
    if (name === '../../../core/table-preferences') return preferences.exports;
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
  return { page, requests, order, resolve, storage, deps };
}
function loaded(permissions) { const e = setup(permissions); e.page.load(); e.resolve(); return e; }
const dragEvent = (clientY = 0) => ({ clientY, preventDefault() { this.prevented = true; }, stopPropagation() {}, currentTarget: { contains() { return false; }, getBoundingClientRect() { return { top: 0, height: 100 }; } }, dataTransfer: { setData() {} } });
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
test('read-only orders cannot be dragged; legacy and terminal orders cannot change status', () => {
  const e = loaded([]); e.page.startDrag(dragEvent(), e.order); assert.equal(e.page.dragged, null); e.page.move(e.order, 'confirmed'); assert.equal(e.requests.length, 7);
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

function boardCards(status = 'completed', storage) {
  const e = setup(undefined, storage);
  const rows = ['a', 'b', 'c'].map(id => ({ ...e.order, id, status, orderNumber: `SO-${id}` }));
  e.page.load(); e.resolve(rows);
  return { ...e, rows, column: e.page.columns.find(c => c.id === status) };
}
const ids = column => Array.from(column.rows, row => row.id);

test('completed cards drag before another card without any workflow write or field changes', () => {
  const e = boardCards(), event = dragEvent();
  const original = JSON.stringify(e.rows);
  assert.equal(e.page.canDrag(e.rows[2]), true);
  assert.equal(e.page.movable(e.rows[2]), false);
  e.page.startDrag(event, e.rows[2]); e.page.dragOver(event, e.column, e.rows[0]);
  assert.equal(e.page.dropTarget, 'completed'); assert.equal(e.page.dropCardId, 'a'); assert.equal(e.page.dropAfter, false);
  e.page.drop(event, e.column);
  assert.deepEqual(ids(e.column), ['c', 'a', 'b']); assert.equal(e.requests.length, 7);
  assert.equal(JSON.stringify(e.rows), original); assert.equal(e.page.dragged, null); assert.equal(e.page.dropCardId, '');
});

test('completed cards still reject every other column, including forged drop and move calls', () => {
  const e = boardCards();
  for (const column of e.page.columns.filter(c => c.id !== 'completed')) {
    const event = dragEvent(); e.page.startDrag(event, e.rows[0]); e.page.dragOver(event, column);
    assert.equal(event.prevented, undefined); assert.equal(event.dataTransfer.dropEffect, 'none');
    assert.equal(e.page.canDrop(e.rows[0], column), false); assert.equal(e.page.dropTarget, '');
    e.page.drop(event, column); e.page.move(e.rows[0], column.id); assert.equal(e.page.selected, null);
  }
  assert.deepEqual(ids(e.column), ['a', 'b', 'c']); assert.equal(e.requests.length, 7);
});

test('active cards reorder after a card or at the end without triggering status actions', () => {
  const e = boardCards('draft'), event = dragEvent(90);
  e.page.startDrag(event, e.rows[0]); e.page.dragOver(event, e.column, e.rows[1]);
  assert.equal(e.page.dropAfter, true); e.page.drop(event, e.column);
  assert.deepEqual(ids(e.column), ['b', 'a', 'c']);
  e.page.startDrag(event, e.rows[1]); e.page.dragOver(event, e.column); e.page.drop(event, e.column);
  assert.deepEqual(ids(e.column), ['a', 'c', 'b']); assert.equal(e.requests.length, 7);
});

test('dropping on itself or cancelling a drag leaves the order unchanged', () => {
  const e = boardCards(), event = dragEvent();
  e.page.startDrag(event, e.rows[1]); e.page.dragOver(event, e.column, e.rows[1]); e.page.drop(event, e.column);
  e.page.startDrag(event, e.rows[2]); e.page.dragOver(event, e.column, e.rows[0]); e.page.endDrag();
  assert.deepEqual(ids(e.column), ['a', 'b', 'c']); assert.equal(e.storage.size, 0);
});

test('saved card order survives refresh and a new board, isolated by account and organization', () => {
  const e = boardCards(); e.page.shiftOrder(e.rows[2], e.column, -1);
  e.page.load(); e.resolve(e.rows);
  assert.deepEqual(ids(e.page.columns.find(c => c.id === 'completed')), ['a', 'c', 'b']);
  const reopened = boardCards('completed', e.storage);
  assert.deepEqual(ids(reopened.column), ['a', 'c', 'b']);
  reopened.page.organizationId = 'org-b'; reopened.page.ngOnChanges(); reopened.resolve(reopened.rows);
  assert.deepEqual(ids(reopened.page.columns.find(c => c.id === 'completed')), ['a', 'b', 'c']);
  reopened.page.organizationId = 'org-a'; reopened.deps.AuthService.currentUser = () => ({ id: 'user-b' });
  reopened.page.ngOnChanges(); reopened.resolve(reopened.rows);
  assert.deepEqual(ids(reopened.page.columns.find(c => c.id === 'completed')), ['a', 'b', 'c']);
});

test('filtered reordering preserves hidden card positions and restores them on load more', () => {
  const e = boardCards(); e.page.shiftOrder(e.rows[2], e.column, -1); // a,c,b
  e.page.search = 'matching'; e.page.ngOnChanges(); e.resolve([e.rows[0], e.rows[1]]);
  let column = e.page.columns.find(c => c.id === 'completed');
  e.page.shiftOrder(e.rows[1], column, -1); // b,c,a (c hidden)
  e.page.search = ''; e.page.ngOnChanges(); e.resolve([e.rows[0], e.rows[1]], 3);
  column = e.page.columns.find(c => c.id === 'completed');
  assert.deepEqual(ids(column), ['b', 'a']);
  e.page.more(column); e.requests.at(-1).stream.next({ data: [e.rows[2]], meta: { total: 3 } });
  assert.deepEqual(ids(column), ['b', 'c', 'a']); assert.equal(column.page, 2); assert.equal(column.total, 3);
});

test('reordering is blocked while busy, in a move dialog, or without permission', () => {
  const e = boardCards();
  for (const block of ['busy', 'dialog', 'permission']) {
    e.page.movingId = block === 'busy' ? 'other' : '';
    e.page.selected = block === 'dialog' ? e.rows[0] : null;
    e.deps.AuthService.hasPermission = () => block !== 'permission';
    e.page.startDrag(dragEvent(), e.rows[2]); assert.equal(e.page.dragged, null);
    e.page.shiftOrder(e.rows[2], e.column, -1); assert.deepEqual(ids(e.column), ['a', 'b', 'c']);
  }
  assert.equal(e.storage.size, 0); assert.equal(e.requests.length, 7);
});

test('unavailable browser storage keeps reordering usable for the session', () => {
  const e = boardCards(); e.storage.set = () => { throw new Error('Quota exceeded'); };
  e.page.shiftOrder(e.rows[1], e.column, -1); assert.deepEqual(ids(e.column), ['b', 'a', 'c']);
  assert.match(e.page.notice, /session/); e.page.load(); e.resolve(e.rows);
  assert.deepEqual(ids(e.page.columns.find(c => c.id === 'completed')), ['b', 'a', 'c']);
});


test('legacy completed cards can be sorted without enabling any status transition', () => {
  const e = boardCards(); e.rows[2].workflow = null;
  assert.equal(e.page.canDrag(e.rows[2]), true);
  e.page.shiftOrder(e.rows[2], e.column, -1);
  assert.deepEqual(ids(e.column), ['a', 'c', 'b']);
  for (const column of e.page.columns.filter(c => c.id !== 'completed')) {
    assert.equal(e.page.canDrop(e.rows[2], column), false);
    e.page.startDrag(dragEvent(), e.rows[2]); e.page.drop(dragEvent(), column);
  }
  assert.equal(e.requests.length, 7);
});
