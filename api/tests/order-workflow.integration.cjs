// Run explicitly against the local migrated development database:
// docker exec biz-assitant-api node tests/order-workflow.integration.cjs
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { authenticateSequelize, getModels } = require('../src/sequelize');
const controller = require('../src/controllers/order-workflow-controller');
const legacy = require('../src/controllers/orders-controller');
(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Integration fixtures must not run in production.');
  const db = await authenticateSequelize(); const m = getModels(); const marker = `ORDER-WORKFLOW-TEST-${randomUUID()}`;
  let org, otherOrg, uploadUser, otherUploadUser; const originalNotify = legacy.notifyOrderCreated; legacy.notifyOrderCreated = async () => {};
  try {
    const tax = await m.TaxType.findOne({ where: { isActive: true } }); assert.ok(tax, 'An active tax type is needed for the integration fixture.');
    const organization = name => m.Organization.create({ name, addressLine1: 'Integration fixture', city: 'Test', country: 'Philippines', contactEmail: 'test@example.invalid', phone: '0', currency: 'PHP', taxTypeId: tax.id });
    org = await organization(marker); otherOrg = await organization(`${marker}-other`);
    const customer = await m.Customer.create({ organizationId: org.id, name: marker, taxId: marker, requiresPurchaseOrder: true });
    const item = await m.Item.create({ organizationId: org.id, name: marker, type: 'product', sku: marker, price: 100, stock: 10, currency: 'PHP', unit: 'm' });
    uploadUser = await m.User.create({ firstName: 'Upload', lastName: 'Fixture', email: `${randomUUID()}@example.invalid`, password: randomUUID(), organizationId: org.id });
    otherUploadUser = await m.User.create({ firstName: 'Other', lastName: 'Fixture', email: `${randomUUID()}@example.invalid`, password: randomUUID(), organizationId: org.id });
    const auth = { userId: uploadUser.id, user: { organizationId: org.id }, roleCodes: ['administrator'], isPrivileged: true, permissions: new Set() };
    const request = async (method, body = {}, id, override = {}) => {
      const req = { body, query: {}, params: { id }, auth, ...override };
      const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set(values) { Object.assign(this.headers, values); return this; }, send(body) { this.body = body; return this; } };
      await controller[method](req, res); return res;
    };
    const expect = (res, status = 200) => { assert.equal(res.statusCode, status, JSON.stringify(res.body)); return res.body?.data; };
    const draftBody = { organizationId: org.id, requestKey: randomUUID(), orderedItems: [{ itemId: item.id, quantity: 1.125 }], customerId: customer.id, customerPoNumber: 'PO-TEST', customerPoAmount: 112.5 };
    let order = expect(await request('createOrder', draftBody), 201); assert.equal(order.status, 'draft'); assert.equal(order.workflow.poRequired, true); assert.equal(Number(order.totalAmount), 112.5);
    const duplicate = expect(await request('createOrder', draftBody)); assert.equal(duplicate.id, order.id);
    // Proof is optional, and it can be saved atomically with a new or revised draft.
    const proofFile = { originalname: 'customer-proof.pdf', buffer: Buffer.from('%PDF-1.7\nproof') };
    const proofBody = { organizationId: org.id, requestKey: randomUUID(), orderedItems: [{ name: 'Proof upload fixture', type: 'service', quantity: 1, unitPrice: 10 }], poRequired: false };
    expect(await request('createOrder', proofBody, undefined, { file: { ...proofFile, buffer: Buffer.from('fake PDF') } }), 400);
    assert.equal(await m.Order.count({ where: { requestKey: proofBody.requestKey } }), 0);
    let proofOrder = expect(await request('createOrder', proofBody, undefined, { file: proofFile }), 201);
    assert.equal(proofOrder.documents.length, 1); assert.equal(proofOrder.workflow.poRequired, false); assert.equal(proofOrder.workflow.po.status, 'unverified');
    assert.equal(proofOrder.documents[0].toJSON().content, undefined);
    const retried = expect(await request('createOrder', proofBody, undefined, { file: proofFile }));
    assert.equal(retried.id, proofOrder.id); assert.equal(retried.documents.length, 1);
    expect(await request('updateOrder', { ...proofBody, revision: proofOrder.revision }, proofOrder.id, { file: proofFile, auth: { ...auth, user: { organizationId: otherOrg.id } } }), 404);
    proofOrder = expect(await request('updateOrder', { ...proofBody, revision: proofOrder.revision }, proofOrder.id, { file: proofFile }));
    assert.equal(proofOrder.revision, 2); assert.equal(proofOrder.documents.length, 2);
    expect(await request('updateOrder', { ...proofBody, revision: 1 }, proofOrder.id, { file: proofFile }), 409);
    assert.equal(await m.OrderDocument.count({ where: { orderId: proofOrder.id } }), 2);
    const originalDocumentCreate = m.OrderDocument.create;
    const failedCreateKey = randomUUID();
    try {
      m.OrderDocument.create = async () => { const error = new Error('Simulated upload storage failure'); error.status = 503; throw error; };
      expect(await request('createOrder', { ...proofBody, requestKey: failedCreateKey }, undefined, { file: proofFile }), 503);
      expect(await request('updateOrder', { ...proofBody, revision: proofOrder.revision, notes: 'Must roll back', orderedItems: [{ name: 'Must roll back', type: 'service', quantity: 1, unitPrice: 999 }] }, proofOrder.id, { file: proofFile }), 503);
    } finally { m.OrderDocument.create = originalDocumentCreate; }
    assert.equal(await m.Order.count({ where: { requestKey: failedCreateKey } }), 0);
    const unchanged = expect(await request('getOrder', {}, proofOrder.id));
    assert.equal(unchanged.revision, proofOrder.revision); assert.equal(Number(unchanged.totalAmount), 10); assert.equal(unchanged.notes, null); assert.equal(unchanged.documents.length, 2);
    proofOrder = expect(await request('performAction', { action: 'confirm', revision: proofOrder.revision }, proofOrder.id));
    assert.equal(proofOrder.status, 'confirmed'); // No verification gate for optional proof.
    expect(await request('uploadDocument', { revision: proofOrder.revision }, proofOrder.id, { file: proofFile }), 400);
    await m.Order.destroy({ where: { id: proofOrder.id, organizationId: org.id } });
    // Immediate uploads belong to one user, organization and optional target order.
    const uploadIds = [randomUUID(), randomUUID()];
    for (const uploadId of uploadIds) expect(await request('stageDocument', { uploadId, organizationId: org.id }, undefined, { file: proofFile }), 201);
    expect(await request('stageDocument', { uploadId: uploadIds[0], organizationId: org.id }, undefined, { file: proofFile }), 201);
    assert.equal(await m.OrderDocumentUpload.count({ where: { userId: uploadUser.id } }), 2);
    expect(await request('stageDocument', { uploadId: randomUUID(), organizationId: org.id }, undefined, { file: proofFile, auth: { ...auth, isPrivileged: false, permissions: new Set(['orders.read']) } }), 403);
    const stagedBody = { ...proofBody, requestKey: randomUUID(), uploadIds };
    expect(await request('createOrder', stagedBody, undefined, { auth: { ...auth, userId: otherUploadUser.id } }), 400);
    expect(await request('createOrder', { ...stagedBody, organizationId: otherOrg.id }, undefined, { auth: { ...auth, user: { organizationId: otherOrg.id } } }), 400);
    assert.equal(await m.Order.count({ where: { requestKey: stagedBody.requestKey } }), 0);
    try {
      m.OrderDocument.create = async () => { const error = new Error('Simulated staged file failure'); error.status = 503; throw error; };
      expect(await request('createOrder', stagedBody), 503);
    } finally { m.OrderDocument.create = originalDocumentCreate; }
    assert.equal(await m.OrderDocumentUpload.count({ where: { userId: uploadUser.id } }), 2);
    let stagedOrder = expect(await request('createOrder', stagedBody), 201);
    assert.equal(stagedOrder.documents.length, 2); assert.equal(stagedOrder.workflow.poRequired, false);
    assert.equal(await m.OrderDocumentUpload.count({ where: { userId: uploadUser.id } }), 0);
    assert.equal(expect(await request('createOrder', stagedBody)).documents.length, 2);
    const targetedId = randomUUID();
    expect(await request('stageDocument', { uploadId: targetedId, organizationId: org.id, orderId: stagedOrder.id }, undefined, { file: proofFile }), 201);
    expect(await request('createOrder', { ...proofBody, requestKey: randomUUID(), uploadIds: [targetedId] }), 400);
    stagedOrder = expect(await request('updateOrder', { ...proofBody, revision: stagedOrder.revision, uploadIds: [targetedId] }, stagedOrder.id));
    assert.equal(stagedOrder.documents.length, 3);
    stagedOrder = expect(await request('performAction', { action: 'confirm', revision: stagedOrder.revision }, stagedOrder.id));
    expect(await request('stageDocument', { uploadId: randomUUID(), organizationId: org.id, orderId: stagedOrder.id }, undefined, { file: proofFile }), 400);
    const discardId = randomUUID();
    expect(await request('stageDocument', { uploadId: discardId, organizationId: org.id }, undefined, { file: proofFile }), 201);
    expect(await request('discardUpload', {}, undefined, { params: { uploadId: discardId }, auth: { ...auth, userId: otherUploadUser.id } }));
    assert.equal(await m.OrderDocumentUpload.count({ where: { id: discardId } }), 1);
    expect(await request('discardUpload', {}, undefined, { params: { uploadId: discardId } }));
    assert.equal(await m.OrderDocumentUpload.count({ where: { id: discardId } }), 0);
    const expiredId = randomUUID();
    expect(await request('stageDocument', { uploadId: expiredId, organizationId: org.id }, undefined, { file: proofFile }), 201);
    await m.OrderDocumentUpload.update({ expiresAt: new Date(0) }, { where: { id: expiredId } });
    expect(await request('createOrder', { ...proofBody, requestKey: randomUUID(), uploadIds: [expiredId] }), 400);
    await require('../src/jobs/order-upload-cleanup-job').cleanupOrderUploads();
    assert.equal(await m.OrderDocumentUpload.count({ where: { id: expiredId } }), 0);
    await m.Order.destroy({ where: { id: stagedOrder.id, organizationId: org.id } });
    // Legacy expense-classified rates remain selectable for orders, while
    // inactive and cross-organization tax IDs still fail validation.
    const selectedTax = await m.WithholdingTaxType.create({ organizationId: org.id, code: 'ORDER-REGRESSION', name: 'Order withholding fixture', percentage: 2, appliesTo: 'expense', isActive: true });
    const taxBody = { ...proofBody, requestKey: randomUUID(), withholdingTaxTypeId: selectedTax.id, orderedItems: [{ name: 'Tax fixture', type: 'service', quantity: 1, unitPrice: 112 }] };
    let taxedOrder = expect(await request('createOrder', taxBody), 201);
    const deduction = Math.round((112 - Number(taxedOrder.taxAmount)) * 2) / 100;
    assert.ok(deduction > 0); assert.equal(Number(taxedOrder.withHoldingTaxAmount), deduction); assert.equal(Number(taxedOrder.totalAmount), 112 - deduction);
    taxedOrder = expect(await request('updateOrder', { ...taxBody, revision: taxedOrder.revision, orderedItems: [{ name: 'Tax fixture edited', type: 'service', quantity: 2, unitPrice: 112 }] }, taxedOrder.id));
    assert.equal(taxedOrder.withholdingTaxTypeId, selectedTax.id); assert.equal(Number(taxedOrder.withHoldingTaxAmount), deduction * 2);
    expect(await request('createOrder', { ...taxBody, organizationId: otherOrg.id, requestKey: randomUUID() }, undefined, { auth: { ...auth, user: { organizationId: otherOrg.id } } }), 400);
    await selectedTax.update({ isActive: false });
    expect(await request('updateOrder', { ...taxBody, revision: taxedOrder.revision }, taxedOrder.id), 400);
    await m.Order.destroy({ where: { id: taxedOrder.id, organizationId: org.id } });
    const act = (action, body = {}, override = {}) => request('performAction', { action, revision: order.revision, ...body }, order.id, override);
    expect(await act('confirm'), 400);
    expect(await act('start_processing'), 400);
    expect(await act('return_to_draft'), 400);
    expect(await act('verify_po', { note: 'Verified by phone' }, { auth: { ...auth, isPrivileged: false, permissions: new Set(['orders.update']) } }), 403);
    const doc = expect(await request('uploadDocument', { revision: order.revision }, order.id, { file: { originalname: 'customer-po.pdf', buffer: Buffer.from('%PDF-1.7\nsynthetic test document') } })); order = doc;
    const documentId = order.documents[0].id; assert.equal(order.documents[0].content, undefined);
    expect(await request('downloadDocument', {}, order.id, { params: { id: order.id, documentId }, auth: { ...auth, user: { organizationId: otherOrg.id } } }), 404);
    const download = await request('downloadDocument', {}, order.id, { params: { id: order.id, documentId } }); assert.ok(Buffer.isBuffer(download.body)); assert.equal(download.headers['Cache-Control'], 'private, no-store');
    order = expect(await act('verify_po'));
    order = expect(await request('updateOrder', { ...draftBody, revision: order.revision, orderedItems: draftBody.orderedItems }, order.id)); assert.equal(order.workflow.po.status, 'unverified');
    expect(await act('confirm'), 400); order = expect(await act('verify_po'));
    const revision = order.revision;
    const confirms = await Promise.all([act('confirm'), act('confirm')]); assert.deepEqual(confirms.map(r => r.statusCode).sort(), [200, 409]); order = confirms.find(r => r.statusCode === 200).body.data;
    assert.equal(Number((await item.reload()).stock), 8.875); assert.equal(order.revision, revision + 1);
    expect(await request('updateOrder', { ...draftBody, revision: order.revision }, order.id), 400);
    expect(await request('deleteOrder', {}, order.id, { query: { revision: order.revision } }), 400);
    expect(await act('start_processing', {}, { auth: { ...auth, isPrivileged: false, permissions: new Set(['orders.read']) } }), 403);
    order = expect(await act('start_processing')); assert.equal(order.status, 'processing'); assert.equal(order.fulfillmentStatus, 'unfulfilled'); assert.equal(Number((await item.reload()).stock), 8.875);
    expect(await act('start_processing'), 400); expect(await act('return_to_draft'), 400);
    const line = order.orderedItemSnapshots[0]; order = expect(await act('fulfill', { lines: [{ id: line.id, quantity: 0.125 }] })); assert.equal(order.fulfillmentStatus, 'partially_fulfilled');
    expect(await act('complete'), 400); expect(await act('fulfill', { lines: [{ id: line.id, quantity: 1.001 }] }), 400);
    order = expect(await act('invoice', { amount: 40 })); const invoice1 = order.salesInvoices[0];
    order = expect(await act('invoice', { amount: 72.5 })); assert.equal(order.salesInvoices.length, 2); assert.equal(order.invoicingStatus, 'invoiced');
    expect(await act('invoice', { amount: 1 }), 400);
    const managedInvoice = await m.SalesInvoice.findByPk(invoice1.id); await assert.rejects(() => managedInvoice.update({ status: 'paid' }), /order workspace/);
    order = expect(await act('payment', { amount: 20, invoiceId: invoice1.id, note: 'BANK-TEST-1' })); assert.equal(order.paymentStatus, 'partially_paid');
    expect(await act('payment', { amount: 21, invoiceId: invoice1.id, note: 'BANK-TEST-2' }), 400);
    expect(await act('void_invoice', { invoiceId: invoice1.id, note: 'test' }), 400);
    order = expect(await act('fulfill', { lines: [{ id: line.id, quantity: 1 }] })); order = expect(await act('complete')); assert.equal(order.status, 'completed'); assert.equal(order.paymentStatus, 'partially_paid');
    order = expect(await act('refund', { amount: 5, invoiceId: invoice1.id, note: 'Partial refund test' })); assert.equal(order.balances.paid, 15); assert.equal(Number((await item.reload()).stock), 8.875);
    expect(await request('getOrder', {}, order.id, { auth: { ...auth, user: { organizationId: otherOrg.id } } }), 404);
    const mainId = order.id;
    // Independent cancellation, approval gate, and competing stock commitments.
    await org.update({ orderWorkflowSettings: { preset: 'distribution', customerRequired: false, inventoryEnabled: true, shippingEnabled: true, approvalThreshold: 0, paymentTermsDays: 30 } });
    order = expect(await request('createOrder', { requestKey: randomUUID(), orderedItems: [{ itemId: item.id, quantity: 0.375 }] }), 201);
    expect(await act('confirm'), 400); order = expect(await act('submit')); order = expect(await act('approve')); order = expect(await act('return_to_draft')); assert.equal(order.status, 'draft'); assert.equal(order.workflow.approval, 'not_required'); expect(await act('confirm'), 400); order = expect(await act('submit')); order = expect(await act('approve')); order = expect(await act('confirm')); assert.equal(Number((await item.reload()).stock), 8.5);
    order = expect(await act('cancel', { note: 'Customer cancelled before delivery' })); assert.equal(Number((await item.reload()).stock), 8.875);
    expect(await act('cancel', { note: 'Retry' }), 400);
    await org.update({ orderWorkflowSettings: null });
    const create = () => request('createOrder', { requestKey: randomUUID(), orderedItems: [{ itemId: item.id, quantity: 8 }] });
    const a = expect(await create(), 201), b = expect(await create(), 201);
    const competing = await Promise.all([request('performAction', { action: 'confirm', revision: a.revision }, a.id), request('performAction', { action: 'confirm', revision: b.revision }, b.id)]);
    assert.deepEqual(competing.map(r => r.statusCode).sort(), [200, 400]); assert.equal(Number((await item.reload()).stock), 0.875);
    // Work queues count orders, not joined line rows.
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(body) { this.body = body; return this; } };
    await legacy.listOrders({ auth, query: { view: 'ready_to_invoice', q: '' } }, res); assert.equal(res.statusCode, 200); assert.equal(res.body.meta.total, 1);
    await legacy.listOrders({ auth, query: { view: 'ready_to_invoice', status: 'draft' } }, res); assert.equal(res.body.meta.total, 0);
    await legacy.listOrders({ auth, query: { view: 'ready_to_invoice', status: 'confirmed' } }, res); assert.equal(res.body.meta.total, 1);
    assert.ok(await m.OrderActivity.count({ where: { orderId: mainId } }) >= 10);
    console.log('PASS: staged multi-file upload ownership, retry, expiry, rollback, target binding, live database workflow, PO access, CAS/concurrency, decimal stock, partial fulfillment, milestone invoices, payments/refunds, approval, cancellation, and tenant isolation.');
  } finally {
    legacy.notifyOrderCreated = originalNotify;
    // Only delete the organizations created by this test, guarded by both UUID and marker.
    for (const value of [org, otherOrg]) if (value) await m.Organization.destroy({ where: { id: value.id, name: value.name } });
    for (const user of [uploadUser, otherUploadUser]) if (user) await m.User.destroy({ where: { id: user.id, email: user.email } });
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
