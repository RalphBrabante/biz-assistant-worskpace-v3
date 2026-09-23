const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { cleanupOrderUploads } = require('../jobs/order-upload-cleanup-job');
const { getModels } = require('../sequelize');
const { getScopedOrganizationId, applyOrganizationWhereScope, isPrivilegedRequest } = require('../services/request-scope');
const { createOrganizationMessage } = require('../services/message-service');
const W = require('../services/order-workflow');

const actions = { start_processing: 'orders.update', return_to_draft: 'orders.update', submit: 'orders.update', approve: 'orders.approve', reject: 'orders.approve', verify_po: 'orders.verify_po', confirm: 'orders.update', fulfill: 'orders.update', invoice: 'sales_invoices.create', void_invoice: 'sales_invoices.update', payment: 'sales_invoices.update', refund: 'orders.refund', complete: 'orders.update', cancel: 'orders.update', reconcile: 'orders.reconcile' };
const endpoint = fn => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ ok: false, message: 'This document or request already exists. Reload before retrying.' });
    if (!error.status) console.error('Order workflow error:', error);
    res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Unable to process this order.' });
  }
};
function models() { const m = getModels(); if (!m?.OrderDocument) W.fail('Order service is not ready.', 503); return m; }
function scope(req, where = {}) { const scoped = applyOrganizationWhereScope(where, req); if (!scoped) W.fail('Order not found.', 404); return scoped; }
async function findOrder(req, transaction) {
  const order = await models().Order.findOne({ where: scope(req, { id: req.params.id }), transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!order) W.fail('Order not found.', 404);
  return order;
}
const actor = req => req.auth?.user?.id || req.auth?.userId || null;
async function activity(order, req, transaction, action, description, metadata = {}) {
  await models().OrderActivity.create({ orderId: order.id, organizationId: order.organizationId, userId: actor(req), actionType: action, title: action.replace(/_/g, ' '), description, metadata }, { transaction });
}
async function attachDocument(order, document, req, transaction) {
  const doc = await models().OrderDocument.create({ ...document, orderId: order.id }, { transaction });
  const workflow = JSON.parse(JSON.stringify(order.workflow));
  workflow.po = { ...workflow.po, documentId: doc.id, status: 'unverified', verifiedBy: null, verifiedAt: null, verificationNote: null };
  workflow.approval = 'not_required';
  workflow.approvedBy = null;
  await order.update({ workflow }, { transaction });
  await activity(order, req, transaction, 'po_uploaded', `Proof of order attached: ${document.name}. Any previous verification and approval reset.`, { documentId: doc.id });
}
const uploadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function attachUploadedDocuments(order, req, transaction, targetOrderId) {
  const ids = req.body.uploadIds ?? [];
  if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !uploadIdPattern.test(id))) W.fail('Choose up to 10 distinct uploaded files.');
  if (!ids.length) return;
  const uploads = await models().OrderDocumentUpload.unscoped().findAll({ where: {
    id: ids, userId: actor(req), organizationId: order.organizationId, targetOrderId,
    expiresAt: { [Op.gt]: new Date() },
  }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  if (uploads.length !== ids.length) W.fail('An upload expired or is unavailable for this order. Remove it and upload the file again.');
  for (const id of ids) {
    const upload = uploads.find(value => value.id === id);
    const { name, mimeType, size, content } = upload;
    await attachDocument(order, { name, mimeType, size, content }, req, transaction);
    await upload.destroy({ transaction });
  }
}
const stageDocument = endpoint(async (req, res) => {
  const targetOrderId = req.body.orderId || null;
  W.requirePermission(req, targetOrderId ? 'orders.update' : 'orders.create');
  const document = W.verifyFile(req.file);
  const id = req.body.uploadId;
  if (!uploadIdPattern.test(String(id || ''))) W.fail('A valid upload ID is required.');
  await cleanupOrderUploads();
  const uploaded = await models().Order.sequelize.transaction(async transaction => {
    const org = await getOrganization(req, transaction);
    if (targetOrderId) {
      const order = await findOrder({ ...req, params: { id: targetOrderId } }, transaction);
      if (order.organizationId !== org.id) W.fail('Order not found.', 404);
      W.assertManaged(order);
      if (!W.editable(order)) W.fail('Attachments are locked after confirmation.');
    }
    // Serialize the per-user quota and retries even when files arrive together.
    const user = await models().User.findByPk(actor(req), { attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
    if (!user) W.fail('Authentication required.', 401);
    const previous = await models().OrderDocumentUpload.unscoped().findByPk(id, { transaction });
    if (previous) {
      if (previous.userId !== actor(req) || previous.organizationId !== org.id || previous.targetOrderId !== targetOrderId || previous.name !== document.name || !previous.content.equals(document.content)) W.fail('Upload ID is already in use.', 409);
      return previous;
    }
    if (await models().OrderDocumentUpload.count({ where: { userId: actor(req) }, transaction }) >= 20) W.fail('Too many pending uploads. Save an order or remove unused files first.', 429);
    return models().OrderDocumentUpload.create({ ...document, id, organizationId: org.id, userId: actor(req), targetOrderId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, { transaction });
  });
  res.status(201).json({ ok: true, data: { id: uploaded.id, name: uploaded.name, size: uploaded.size, expiresAt: uploaded.expiresAt } });
});
const discardUpload = endpoint(async (req, res) => {
  // Only the uploader can discard staged files, including a superuser.
  await models().OrderDocumentUpload.destroy({ where: { id: req.params.uploadId, userId: actor(req) } });
  res.json({ ok: true });
});
async function detail(order) {
  const m = models();
  const [lines, customer, invoices, activities, documents] = await Promise.all([
    m.OrderItemSnapshot.findAll({ where: { orderId: order.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']] }),
    order.customerId ? m.Customer.findByPk(order.customerId, { attributes: ['id', 'name', 'requiresPurchaseOrder'] }) : null,
    m.SalesInvoice.findAll({ where: { orderId: order.id }, order: [['createdAt', 'ASC']] }),
    m.OrderActivity.findAll({ where: { orderId: order.id }, include: [{ association: 'actor', attributes: ['id', 'firstName', 'lastName'] }], order: [['createdAt', 'DESC'], ['id', 'DESC']] }),
    m.OrderDocument.findAll({ where: { orderId: order.id }, order: [['createdAt', 'DESC']] }),
  ]);
  return { ...order.toJSON(), customer, orderedItemSnapshots: lines.sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0)), salesInvoices: invoices, activities, documents, balances: W.balances(order, invoices) };
}
async function getOrganization(req, transaction, id) {
  const organizationId = id || getScopedOrganizationId(req);
  if (!organizationId || organizationId === '__all__') W.fail('Select an organization first.');
  if (!isPrivilegedRequest(req) && organizationId !== req.auth?.user?.organizationId) W.fail('Organization not found.', 404);
  const org = await models().Organization.findByPk(organizationId, { include: [{ association: 'taxType' }], transaction });
  if (!org) W.fail('Organization not found.', 404);
  return org;
}
async function prepare(req, org, transaction, previous) {
  const m = models(); const body = req.body;
  const config = previous?.workflow?.settings || W.settings(org.orderWorkflowSettings || {});
  let customer = null;
  if (body.customerId) {
    customer = await m.Customer.findOne({ where: { id: body.customerId, organizationId: org.id, isActive: true }, transaction });
    if (!customer) W.fail('Select an active customer in this organization.');
  }
  if (config.customerRequired && !customer) W.fail('A customer is required for this organization.');
  if (!org.taxType || org.taxType.isActive === false) W.fail('Configure an active organization tax type before saving orders.');
  const ids = [...new Set((body.orderedItems || []).map(l => l.itemId).filter(Boolean))];
  const items = ids.length ? await m.Item.findAll({ where: { id: ids, organizationId: org.id, isActive: true }, transaction }) : [];
  const lines = W.buildLines(body.orderedItems, new Map(items.map(i => [i.id, i])), org.taxType, org.currency || 'USD', W.permitted(req, 'orders.override_price'));
  let withholdingRate = 0;
  if (body.withholdingTaxTypeId) {
    const tax = await m.WithholdingTaxType.findOne({ where: { id: body.withholdingTaxTypeId, organizationId: org.id, isActive: true, appliesTo: ['invoice', 'both'] }, transaction });
    if (!tax) W.fail('Select a valid invoice withholding tax type.');
    withholdingRate = Number(tax.percentage);
  }
  const poRequired = !!customer?.requiresPurchaseOrder || body.poRequired === true;
  if (poRequired && !customer) W.fail('Choose a customer for an order requiring a PO.');
  const workflow = previous?.workflow ? JSON.parse(JSON.stringify(previous.workflow)) : W.newWorkflow(config);
  workflow.poRequired = poRequired;
  workflow.approval = 'not_required';
  workflow.approvedBy = null;
  workflow.po = { ...workflow.po, status: 'unverified', verifiedBy: null, verifiedAt: null, verificationNote: null,
    date: W.date(body.customerPoDate, 'PO date'), amount: body.customerPoAmount === '' || body.customerPoAmount == null ? null : W.number(body.customerPoAmount, 'PO amount') };
  workflow.paymentTermsDays = W.number(body.paymentTermsDays ?? customer?.paymentTermsDays ?? config.paymentTermsDays, 'Payment terms', { max: 3650, decimals: 0 });
  const values = { organizationId: org.id, customerId: customer?.id || null, currency: org.currency || 'USD', status: 'draft', workflow,
    customerPoNumber: W.text(body.customerPoNumber, 'PO number', 120), promisedDate: W.date(body.promisedDate, 'Promised date'),
    dueDate: W.date(body.dueDate, 'Due date'), billingAddress: W.text(body.billingAddress, 'Billing address'),
    shippingAddress: config.shippingEnabled ? W.text(body.shippingAddress, 'Shipping address') : null, notes: W.text(body.notes, 'Notes'),
    withholdingTaxTypeId: body.withholdingTaxTypeId || null,
    ...W.totals(lines, config.shippingEnabled ? body.shippingAmount || 0 : 0, withholdingRate), updatedBy: actor(req) };
  return { values, lines };
}
async function stock(order, quantities, direction, transaction) {
  const ids = Object.keys(quantities).sort();
  if (!ids.length) return;
  const items = await models().Item.findAll({ where: { id: ids, organizationId: order.organizationId }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  if (items.length !== ids.length) W.fail('An inventory item no longer exists. Reconcile inventory before continuing.');
  for (const item of items) {
    const next = W.quantity(Number(item.stock) + direction * quantities[item.id]);
    if (next < 0) W.fail(`Insufficient available stock for ${item.name}: ${item.stock} available.`);
    await item.update({ stock: next }, { transaction });
  }
}
const getSettings = endpoint(async (req, res) => {
  const org = await getOrganization(req);
  res.json({ ok: true, data: { settings: W.settings(org.orderWorkflowSettings || {}), presets: W.PRESETS, currency: org.currency, taxType: org.taxType } });
});
const saveSettings = endpoint(async (req, res) => {
  W.requirePermission(req, 'orders.configure');
  const org = await getOrganization(req);
  await org.update({ orderWorkflowSettings: W.settings(req.body.settings) });
  res.json({ ok: true, data: { settings: org.orderWorkflowSettings } });
});
const createOrder = endpoint(async (req, res) => {
  const m = models();
  const document = req.file ? W.verifyFile(req.file) : null;
  const requestKey = String(req.body.requestKey || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) W.fail('A valid requestKey is required.');
  let created = false;
  const order = await m.Order.sequelize.transaction(async transaction => {
    const org = await getOrganization(req, transaction);
    const existing = await m.Order.findOne({ where: { organizationId: org.id, requestKey }, transaction });
    if (existing) return existing;
    const { values, lines } = await prepare(req, org, transaction);
    const order = await m.Order.create({ ...values, requestKey, orderNumber: `SO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`, revision: 1, source: 'web', userId: actor(req), createdBy: actor(req) }, { transaction });
    await m.OrderItemSnapshot.bulkCreate(lines.map(l => ({ ...l, orderId: order.id })), { transaction });
    await activity(order, req, transaction, 'order_created', 'Draft order created.');
    if (document) await attachDocument(order, document, req, transaction);
    await attachUploadedDocuments(order, req, transaction, null);
    await createOrganizationMessage({ organizationId: org.id, entityType: 'order', entityId: order.id, title: 'New order draft', message: `Order ${order.orderNumber} was created.`, createdBy: actor(req), transaction });
    created = true;
    return order;
  });
  res.status(created ? 201 : 200).json({ ok: true, data: await detail(order) });
  if (created) { try { await require('./orders-controller').notifyOrderCreated(m, order); } catch (error) { console.error('Order notification failed:', error.message); } }
});
const getOrder = endpoint(async (req, res) => res.json({ ok: true, data: await detail(await findOrder(req)) }));
const updateOrder = endpoint(async (req, res) => {
  const m = models();
  const document = req.file ? W.verifyFile(req.file) : null;
  const order = await m.Order.sequelize.transaction(async transaction => {
    const order = await findOrder(req, transaction);
    W.assertManaged(order); W.assertRevision(order, req.body.revision);
    if (!W.editable(order)) W.fail('Confirmed orders are locked. Cancel an unfulfilled order and create a replacement to amend it.');
    const previous = { revision: order.revision, customerId: order.customerId, totalAmount: order.totalAmount, poNumber: order.customerPoNumber, lines: (await m.OrderItemSnapshot.findAll({ where: { orderId: order.id }, transaction })).map(l => l.toJSON()) };
    const { values, lines } = await prepare(req, await getOrganization(req, transaction, order.organizationId), transaction, order);
    await m.OrderItemSnapshot.destroy({ where: { orderId: order.id }, transaction });
    await m.OrderItemSnapshot.bulkCreate(lines.map(l => ({ ...l, orderId: order.id })), { transaction });
    await order.update({ ...values, revision: order.revision + 1 }, { transaction });
    await activity(order, req, transaction, 'draft_updated', 'Draft revised; approval and PO verification reset.', { previous });
    if (document) await attachDocument(order, document, req, transaction);
    await attachUploadedDocuments(order, req, transaction, order.id);
    return order;
  });
  res.json({ ok: true, data: await detail(order) });
});
const deleteOrder = endpoint(async (req, res) => {
  await models().Order.sequelize.transaction(async transaction => {
    const order = await findOrder(req, transaction);
    W.assertRevision(order, req.query.revision);
    if (order.status !== 'draft') W.fail('Only drafts can be deleted. Cancel active orders to retain their history.');
    if (await models().SalesInvoice.count({ where: { orderId: order.id }, transaction })) W.fail('An invoiced order cannot be deleted.');
    await order.destroy({ transaction });
  });
  res.json({ ok: true });
});
const uploadDocument = endpoint(async (req, res) => {
  const document = W.verifyFile(req.file);
  const order = await models().Order.sequelize.transaction(async transaction => {
    const order = await findOrder(req, transaction); W.assertManaged(order); W.assertRevision(order, req.body.revision);
    if (!W.editable(order)) W.fail('PO documents are locked after confirmation.');
    await attachDocument(order, document, req, transaction);
    await order.update({ status: 'draft', revision: order.revision + 1, updatedBy: actor(req) }, { transaction });
    return order;
  });
  res.json({ ok: true, data: await detail(order) });
});
const downloadDocument = endpoint(async (req, res) => {
  const order = await findOrder(req);
  const doc = await models().OrderDocument.unscoped().findOne({ where: { id: req.params.documentId, orderId: order.id } });
  if (!doc) W.fail('Document not found.', 404);
  res.set({ 'Content-Type': doc.mimeType, 'Content-Disposition': `attachment; filename="${doc.name.replace(/"/g, '_')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.send(doc.content);
});
const performAction = endpoint(async (req, res) => {
  const m = models(); const action = req.body.action;
  if (!actions[action]) W.fail('Unknown order action.');
  W.requirePermission(req, actions[action]);
  const order = await m.Order.sequelize.transaction(async transaction => {
    const order = await findOrder(req, transaction);
    W.assertRevision(order, req.body.revision);
    if (action !== 'reconcile') W.assertManaged(order);
    const lines = await m.OrderItemSnapshot.findAll({ where: { orderId: order.id }, transaction });
    const invoices = await m.SalesInvoice.findAll({ where: { orderId: order.id }, transaction, lock: transaction.LOCK.UPDATE });
    let workflow = order.workflow ? JSON.parse(JSON.stringify(order.workflow)) : null;
    const values = { revision: order.revision + 1, updatedBy: actor(req) };
    const note = W.text(req.body.note, 'Note', 2000);
    let event = {};
    if (action === 'reconcile') {
      if (workflow) W.fail('This order already uses the current workflow.');
      if (['completed', 'cancelled', 'refunded'].includes(order.status)) W.fail('Finalized legacy orders retain their original history and cannot be adopted.');
      const org = await getOrganization(req, transaction, order.organizationId);
      workflow = W.newWorkflow(org.orderWorkflowSettings || {});
      workflow.paymentTermsDays = workflow.settings.paymentTermsDays;
      if (!note) W.fail('Record the result of the legacy order review.');
      if (order.paymentStatus !== 'unpaid' || invoices.some(i => i.paymentStatus !== 'unpaid')) W.fail('Legacy orders with payment history must retain their original records. Create a new order for remaining work.');
      if (['confirmed', 'processing'].includes(order.status)) {
        if (!['already_deducted', 'deduct_now', 'not_tracked'].includes(req.body.inventoryDecision)) W.fail('Confirm whether stock was already deducted for this legacy order.');
        const quantities = W.demand(lines);
        if (req.body.inventoryDecision === 'deduct_now') await stock(order, quantities, -1, transaction);
        workflow.stockCommitted = req.body.inventoryDecision === 'not_tracked' ? {} : quantities;
      } else values.status = 'draft';
      if (order.fulfillmentStatus !== 'unfulfilled') W.fail('Legacy orders with fulfillment history must retain their original records. Create a new order for remaining work.');
      event = { inventoryDecision: req.body.inventoryDecision, note };
    } else if (action === 'start_processing') {
      if (order.status !== 'confirmed') W.fail('Only confirmed orders can be moved to processing.');
      values.status = 'processing';
    } else if (action === 'return_to_draft') {
      if (order.status !== 'pending') W.fail('Only pending orders can be returned to draft.');
      workflow.approval = 'not_required'; workflow.approvedBy = null; workflow.approvedAt = null;
      values.status = 'draft';
    } else if (action === 'submit') {
      if (!W.editable(order)) W.fail('Only drafts can be submitted for approval.');
      workflow.approval = 'pending'; values.status = 'pending';
    } else if (action === 'approve' || action === 'reject') {
      if (order.status !== 'pending' || workflow.approval !== 'pending') W.fail('This order is not awaiting approval.');
      if (action === 'reject' && !note) W.fail('Provide a reason for returning this order.');
      workflow.approval = action === 'approve' ? 'approved' : 'rejected'; workflow.approvedBy = actor(req); workflow.approvedAt = new Date().toISOString();
      if (action === 'reject') values.status = 'draft';
    } else if (action === 'verify_po') {
      if (!W.editable(order)) W.fail('PO verification is only available before confirmation.');
      if (!order.customerId || !order.customerPoNumber) W.fail('A customer and PO reference are required.');
      if (!workflow.po.documentId && !note) W.fail('Attach the customer PO or record how it was verified.');
      if (workflow.po.amount !== null && W.money(workflow.po.amount) !== W.money(order.totalAmount) && !note) W.fail('The PO amount differs from the order total. Explain the accepted difference.');
      workflow.po = { ...workflow.po, status: 'verified', verifiedBy: actor(req), verifiedAt: new Date().toISOString(), verificationNote: note };
      event = { customerId: order.customerId, poNumber: order.customerPoNumber, documentId: workflow.po.documentId || null, poAmount: workflow.po.amount, orderTotal: order.totalAmount, revision: order.revision };
    } else if (action === 'confirm') {
      const customer = order.customerId ? await m.Customer.findByPk(order.customerId, { transaction, lock: transaction.LOCK.SHARE }) : null;
      W.confirmationChecks(order, !!customer?.requiresPurchaseOrder);
      if (workflow.settings.inventoryEnabled) { workflow.stockCommitted = W.demand(lines); await stock(order, workflow.stockCommitted, -1, transaction); }
      values.status = 'confirmed';
    } else if (action === 'fulfill') {
      if (!['confirmed', 'processing'].includes(order.status)) W.fail('Confirm the order before recording fulfillment.');
      const submitted = req.body.lines;
      if (!Array.isArray(submitted) || !submitted.length) W.fail('Enter quantities delivered or services completed.');
      const seen = new Set();
      for (const entry of submitted) {
        const line = lines.find(l => l.id === entry.id);
        if (!line || seen.has(entry.id)) W.fail('Invalid or duplicate fulfillment line.');
        seen.add(entry.id);
        const qty = W.number(entry.quantity, 'Fulfillment quantity', { min: 0.001, max: 999999, decimals: 3 });
        const total = W.quantity(Number(workflow.fulfilled[line.id] || 0) + qty);
        if (total > Number(line.quantity)) W.fail(`Fulfillment exceeds the ordered quantity for ${line.name}.`);
        workflow.fulfilled[line.id] = total;
      }
      values.fulfillmentStatus = W.fulfillmentStatus(lines, workflow.fulfilled); values.status = 'processing';
      workflow.receipts.push({ id: randomUUID(), date: new Date().toISOString(), userId: actor(req), note, lines: submitted });
      event = { lines: submitted };
    } else if (action === 'invoice') {
      if (!['confirmed', 'processing', 'completed'].includes(order.status)) W.fail('Confirm the order before issuing an invoice.');
      const balance = W.balances(order, invoices);
      const amount = W.number(req.body.amount, 'Invoice amount', { min: 0.01 });
      if (amount > balance.toInvoice) W.fail('The invoice amount exceeds the remaining order amount.');
      const issueDate = W.date(req.body.issueDate || new Date().toISOString().slice(0, 10), 'Issue date');
      const due = new Date(`${issueDate}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + (workflow.paymentTermsDays ?? 30));
      const allocated = field => W.invoiceAllocation(order, invoices, amount, field);
      const tax = allocated('taxAmount'); const withholding = allocated('withHoldingTaxAmount');
      const invoice = await m.SalesInvoice.create({ orderId: order.id, organizationId: order.organizationId,
        invoiceNumber: W.text(req.body.invoiceNumber, 'Invoice number', 100) || `INV-${randomUUID().slice(0, 12).toUpperCase()}`,
        status: 'issued', paymentStatus: 'unpaid', issueDate, dueDate: W.date(req.body.dueDate, 'Invoice due date') || due.toISOString().slice(0, 10), currency: order.currency,
        amount: W.money(amount + withholding), taxableAmount: W.money(amount + withholding - tax), subtotalAmount: allocated('subtotalAmount'), taxAmount: tax,
        withHoldingTaxAmount: withholding, withholdingTaxTypeId: order.withholdingTaxTypeId, discountAmount: allocated('discountAmount'), totalAmount: amount,
        notes: note, createdBy: actor(req), updatedBy: actor(req) }, { transaction, orderWorkflow: true });
      invoices.push(invoice); event = { invoiceId: invoice.id, amount };
    } else if (action === 'void_invoice') {
      const invoice = invoices.find(i => i.id === req.body.invoiceId);
      if (!invoice || invoice.status === 'void') W.fail('Choose an active invoice.');
      if (!note) W.fail('Provide a reason for voiding the invoice.');
      if (workflow.payments.some(p => p.invoiceId === invoice.id)) W.fail('Invoices with payment history cannot be voided.');
      await invoice.update({ status: 'void', updatedBy: actor(req) }, { transaction, orderWorkflow: true }); event = { invoiceId: invoice.id };
    } else if (action === 'payment' || action === 'refund') {
      if (['draft', 'pending', 'cancelled', 'refunded'].includes(order.status)) W.fail('Payments require an active, confirmed order.');
      const invoice = invoices.find(i => i.id === req.body.invoiceId && i.status !== 'void');
      if (!invoice) W.fail('Choose an active invoice.');
      const amount = W.number(req.body.amount, action === 'refund' ? 'Refund amount' : 'Payment amount', { min: 0.01 });
      if (!note) W.fail('Enter a payment reference or refund reason.');
      const paid = W.money(workflow.payments.filter(p => p.invoiceId === invoice.id).reduce((sum, p) => sum + (p.kind === 'refund' ? -p.amount : p.amount), 0));
      if (action === 'payment' && amount > W.money(Number(invoice.totalAmount) - paid)) W.fail('Payment exceeds the invoice balance.');
      if (action === 'refund' && amount > paid) W.fail('Refund exceeds the amount received for this invoice.');
      const payment = { id: randomUUID(), invoiceId: invoice.id, kind: action, amount, date: W.date(req.body.date || new Date().toISOString().slice(0, 10), 'Payment date'), reference: note, userId: actor(req) };
      workflow.payments.push(payment);
      const net = W.money(paid + (action === 'refund' ? -amount : amount));
      await invoice.update({ status: net >= Number(invoice.totalAmount) ? 'paid' : net > 0 ? 'partially_paid' : 'issued', paymentStatus: net >= Number(invoice.totalAmount) ? 'paid' : net > 0 ? 'partially_paid' : action === 'refund' ? 'refunded' : 'unpaid', paidAt: net >= Number(invoice.totalAmount) ? new Date() : null, updatedBy: actor(req) }, { transaction, orderWorkflow: true });
      event = payment;
    } else if (action === 'complete') {
      if (!['confirmed', 'processing'].includes(order.status) || order.fulfillmentStatus !== 'fulfilled') W.fail('Fulfill all order lines before completing the order.');
      values.status = 'completed';
    } else if (action === 'cancel') {
      if (!['draft', 'pending', 'confirmed', 'processing'].includes(order.status)) W.fail('This order cannot be cancelled.');
      if (!note) W.fail('Provide a cancellation reason.');
      if (order.fulfillmentStatus !== 'unfulfilled' || invoices.some(i => i.status !== 'void') || workflow.payments.length) W.fail('An order with fulfillment, active invoices, or payment history cannot be cancelled.');
      await stock(order, workflow.stockCommitted, 1, transaction); workflow.stockCommitted = {}; values.status = 'cancelled';
    }
    order.workflow = workflow;
    const balance = W.balances(order, invoices);
    values.invoicingStatus = balance.invoiced > 0 && balance.toInvoice <= 0 ? 'invoiced' : balance.invoiced > 0 ? 'partially_invoiced' : 'not_invoiced';
    values.paymentStatus = balance.paid > 0 && balance.paid >= Number(order.totalAmount) ? 'paid' : balance.paid > 0 ? 'partially_paid' : workflow.payments.some(p => p.kind === 'refund') ? 'refunded' : 'unpaid';
    values.paidAt = values.paymentStatus === 'paid' ? order.paidAt || new Date() : null;
    await order.update({ ...values, workflow }, { transaction });
    await activity(order, req, transaction, action, note || `Order action: ${action.replace(/_/g, ' ')}.`, event);
    return order;
  });
  res.json({ ok: true, data: await detail(order) });
});
module.exports = { stageDocument, discardUpload, getSettings, saveSettings, createOrder, getOrder, updateOrder, deleteOrder, uploadDocument, downloadDocument, performAction };
