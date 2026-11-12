const W = require('./order-workflow');
const { isVatTaxType } = require('./tax-calculation');

const address = record => ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'].map(key => record?.[key]).filter(Boolean).join(', ');
const position = line => line.metadata?.position || 0;

// Quantity of each order line already on active (non-void) delivery receipts.
function deliveredOnReceipts(receipts) {
  const totals = {};
  for (const receipt of receipts) {
    if (receipt.status === 'void') continue;
    for (const item of receipt.receiptDocument?.items || []) totals[item.lineId] = W.quantity((totals[item.lineId] || 0) + Number(item.quantity));
  }
  return totals;
}

// Validates requested DR quantities against what is left to put on a receipt.
function receiptItems(lines, receipts, requested) {
  if (!Array.isArray(requested) || !requested.length) W.fail('Enter the quantities on this delivery receipt.');
  const onReceipts = deliveredOnReceipts(receipts); const seen = new Set();
  const items = requested.map(entry => {
    const line = lines.find(l => l.id === entry?.id);
    if (!line || seen.has(entry.id)) W.fail('Invalid or duplicate delivery receipt line.');
    seen.add(entry.id);
    const quantity = W.number(entry.quantity, 'Delivery quantity', { min: 0.001, max: 999999, decimals: 3 });
    if (W.quantity((onReceipts[line.id] || 0) + quantity) > Number(line.quantity)) W.fail(`The delivery receipts for ${line.name} would exceed the ordered quantity.`);
    return { line, quantity };
  });
  return items.sort((a, b) => position(a.line) - position(b.line)).map(({ line, quantity }) => ({
    lineId: line.id, quantity, unit: line.unit || '', name: line.name, description: line.description || '',
  }));
}

// Freeze the printed details at issue time; later customer edits must not rewrite a receipt.
function buildDeliveryReceiptDocument({ order, organization, customer, lines, receipts, requested, details = {} }) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) W.fail('Invalid delivery receipt details.');
  const field = (key, fallback, max = 180) => W.text(details[key] ?? fallback, key, max) || '';
  return {
    version: 1,
    seller: { name: organization.legalName || organization.name, address: address(organization), taxId: organization.taxId || '', phone: organization.phone || '', vatRegistered: isVatTaxType(organization.taxType) },
    deliveredTo: field('deliveredTo', customer?.legalName || customer?.name),
    address: field('address', order.shippingAddress || order.billingAddress || address(customer), 2000),
    taxId: field('taxId', customer?.taxId, 80),
    businessStyle: field('businessStyle', customer?.legalName || customer?.name),
    terms: field('terms', order.workflow?.paymentTermsDays === 0 ? 'Cash' : `${order.workflow?.paymentTermsDays ?? 30} days`, 120),
    poNumber: field('poNumber', order.customerPoNumber, 120),
    deliveredBy: field('deliveredBy', ''),
    preparedBy: field('preparedBy', ''),
    orderNumber: order.orderNumber,
    items: receiptItems(lines, receipts, requested),
  };
}
module.exports = { buildDeliveryReceiptDocument, deliveredOnReceipts };
