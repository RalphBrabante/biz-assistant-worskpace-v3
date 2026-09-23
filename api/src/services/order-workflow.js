const { randomUUID } = require('crypto');
const { isVatTaxType } = require('./tax-calculation');
const DEFAULT_SETTINGS = Object.freeze({ preset: 'distribution', customerRequired: false, inventoryEnabled: true, shippingEnabled: true, approvalThreshold: null, paymentTermsDays: 30 });
const PRESETS = {
  distribution: { ...DEFAULT_SETTINGS },
  services: { ...DEFAULT_SETTINGS, preset: 'services', customerRequired: true, inventoryEnabled: false, shippingEnabled: false },
  projects: { ...DEFAULT_SETTINGS, preset: 'projects', customerRequired: true, inventoryEnabled: false, shippingEnabled: false, approvalThreshold: 0 },
};
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const quantity = value => Math.round(Number(value) * 1000) / 1000;
function number(value, label, { min = 0, max = 999999999, decimals = 2 } = {}) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) fail(`${label} must be a number.`);
  const result = Number(value);
  if (result < min || result > max || Math.abs(result * 10 ** decimals - Math.round(result * 10 ** decimals)) > 0.00001) fail(`${label} must be between ${min} and ${max}, with at most ${decimals} decimal places.`);
  return result;
}
function text(value, label, max = 5000) {
  const result = String(value ?? '').trim();
  if (result.length > max) fail(`${label} is too long (maximum ${max} characters).`);
  return result || null;
}
function date(value, label) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} must be a valid date.`);
  return value;
}
function settings(input = {}) {
  if (!PRESETS[input.preset || 'distribution']) fail('Unknown business preset.');
  const result = { ...DEFAULT_SETTINGS, ...input };
  for (const key of ['customerRequired', 'inventoryEnabled', 'shippingEnabled']) if (typeof result[key] !== 'boolean') fail(`${key} must be true or false.`);
  return { preset: result.preset, customerRequired: result.customerRequired, inventoryEnabled: result.inventoryEnabled, shippingEnabled: result.shippingEnabled,
    approvalThreshold: result.approvalThreshold === null ? null : number(result.approvalThreshold, 'Approval threshold'),
    paymentTermsDays: number(result.paymentTermsDays, 'Payment terms', { max: 3650, decimals: 0 }) };
}
function permitted(req, permission) { return !!req.auth?.isPrivileged || !!req.auth?.permissions?.has(permission); }
function requirePermission(req, permission) { if (!permitted(req, permission)) fail(`Permission required: ${permission}.`, 403); }
function assertRevision(order, expected) { if (!Number.isInteger(Number(expected)) || expected === undefined || Number(expected) !== order.revision) fail('This order has changed. Reload it before trying again.', 409); }
function editable(order) { return ['draft', 'pending'].includes(order.status); }
function assertManaged(order) { if (!order.workflow) fail('Review this legacy order with an administrator before continuing its workflow.', 409); }
function newWorkflow(config) { return { version: 1, settings: settings(config), approval: 'not_required', poRequired: false, po: {}, fulfilled: {}, payments: [], stockCommitted: {}, receipts: [] }; }
function buildLines(entries, itemById, taxType, currency, allowOverride) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 200) fail('Provide between 1 and 200 order lines.');
  const rate = isVatTaxType(taxType) ? Number(taxType.percentage || 0) : 0;
  return entries.map((entry, position) => {
    const item = entry.itemId ? itemById.get(entry.itemId) : null;
    if (entry.itemId && !item) fail('A selected item is inactive or belongs to another organization.');
    const qty = number(entry.quantity, 'Quantity', { min: 0.001, max: 999999, decimals: 3 });
    const catalogPrice = item ? Number(item.discountedPrice ?? item.price) : 0;
    const price = number(entry.unitPrice ?? catalogPrice, 'Unit price', { max: 9999999 });
    if (item && price !== catalogPrice && !allowOverride) fail('You need price override permission to change a catalog price.', 403);
    const name = text(item?.name || entry.name, 'Line description', 180);
    if (!name) fail('Every custom line needs a description.');
    const type = item?.type || entry.type || 'service';
    if (!['product', 'service'].includes(type)) fail('Line type must be product or service.');
    const total = money(qty * price);
    if (total > 999999999) fail('Line amount is too large.');
    return { id: randomUUID(), itemId: item?.id || null, sku: item?.sku || null, name, type,
      description: text(entry.description ?? item?.description, 'Description'), unit: text(item?.unit || entry.unit || 'each', 'Unit', 30), currency,
      quantity: qty, unitPrice: price, discountedUnitPrice: null, taxRate: rate, lineSubtotal: total, lineDiscount: 0,
      lineTax: rate ? money(total - total / (1 + rate / 100)) : 0, lineTotal: total,
      metadata: { position, custom: !item, catalogPrice: item ? catalogPrice : null, priceOverridden: !!item && price !== catalogPrice } };
  });
}
function totals(lines, shipping, withholdingRate = 0) {
  const subtotalAmount = money(lines.reduce((sum, line) => sum + Number(line.lineTotal), 0));
  const taxAmount = money(lines.reduce((sum, line) => sum + Number(line.lineTax), 0));
  const withHoldingTaxAmount = money((subtotalAmount - taxAmount) * withholdingRate / 100);
  const shippingAmount = number(shipping ?? 0, 'Shipping');
  const totalAmount = money(subtotalAmount + shippingAmount - withHoldingTaxAmount);
  if (totalAmount < 0 || totalAmount > 999999999) fail('Order total is out of range.');
  return { subtotalAmount, taxAmount, withHoldingTaxAmount, shippingAmount, totalAmount, discountAmount: money(lines.reduce((sum, line) => sum + Number(line.lineDiscount || 0), 0)) };
}
function demand(lines) {
  const result = {};
  for (const line of lines) if (line.itemId && line.type === 'product') result[line.itemId] = quantity((result[line.itemId] || 0) + Number(line.quantity));
  return result;
}
function approvalNeeded(order) { const threshold = order.workflow.settings.approvalThreshold; return threshold !== null && Number(order.totalAmount) >= threshold; }
function confirmationChecks(order, customerRequiresPo = false) {
  if (!editable(order)) fail('Only draft or pending orders can be confirmed.');
  if ((approvalNeeded(order) || ['pending', 'rejected'].includes(order.workflow.approval)) && order.workflow.approval !== 'approved') fail('Submit this order for approval before confirmation.');
  if ((customerRequiresPo || order.workflow.poRequired) && (!order.customerId || !order.customerPoNumber || order.workflow.po?.status !== 'verified')) fail('A customer and verified purchase order are required before confirmation.');
}
function balances(order, invoices) {
  const active = invoices.filter(i => i.status !== 'void');
  const invoiced = money(active.reduce((s, i) => s + Number(i.totalAmount), 0));
  const paid = money((order.workflow?.payments || []).reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0));
  return { invoiced, paid, toInvoice: money(Number(order.totalAmount) - invoiced), outstanding: money(invoiced - paid), orderBalance: money(Number(order.totalAmount) - paid) };
}
function invoiceAllocation(order, invoices, amount, field) {
  const active = invoices.filter(i => i.status !== 'void');
  const previous = money(active.reduce((sum, i) => sum + Number(i[field] || 0), 0));
  const invoiced = money(active.reduce((sum, i) => sum + Number(i.totalAmount), 0));
  const target = money(Number(order[field]) * money(invoiced + amount) / Number(order.totalAmount));
  const allocation = money(target - previous);
  if (allocation < 0) fail('Existing invoice allocations need financial review before issuing another invoice.');
  return allocation;
}
function fulfillmentStatus(lines, fulfilled) {
  if (lines.length && lines.every(l => quantity(fulfilled[l.id] || 0) === Number(l.quantity))) return 'fulfilled';
  return Object.values(fulfilled).some(q => Number(q) > 0) ? 'partially_fulfilled' : 'unfulfilled';
}
function verifyFile(file) {
  if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024) fail('Choose a PDF, PNG, or JPEG up to 5 MB.');
  const b = file.buffer;
  const mime = b.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf'
    : b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'image/jpeg' : null;
  if (!mime) fail('Only PDF, PNG, and JPEG documents are supported.');
  return { name: String(file.originalname || 'purchase-order').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180), mimeType: mime, size: b.length, content: b };
}
module.exports = { DEFAULT_SETTINGS, PRESETS, fail, money, quantity, number, text, date, settings, permitted, requirePermission, assertRevision, editable, assertManaged, newWorkflow, buildLines, totals, demand, approvalNeeded, confirmationChecks, balances, invoiceAllocation, fulfillmentStatus, verifyFile };
