const W = require('./order-workflow');

const address = record => ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'].map(key => record?.[key]).filter(Boolean).join(', ');

// Freeze the printed details at issue time; customer/catalog edits must not
// rewrite an invoice. Financial values always come from the locked order.
function buildInvoiceDocument({ order, organization, customer, lines, invoice, details = {} }) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) W.fail('Invalid invoice details.');
  const field = (key, fallback, max = 180) => W.text(details[key] ?? fallback, key, max) || '';
  const fullOrder = W.money(invoice.totalAmount) === W.money(order.totalAmount);
  const gross = W.money(Number(invoice.totalAmount) + Number(invoice.withHoldingTaxAmount));
  const sales = Number(invoice.subtotalAmount);
  const shipping = Number(invoice.shippingAmount ?? (Number(order.shippingAmount) > 0 ? W.money(gross - sales) : 0));
  const roundingAdjustment = W.money(gross - sales - shipping);
  const tax = Number(invoice.taxAmount);
  const items = fullOrder ? [...lines].sort((a, b) => (a.metadata?.position || 0) - (b.metadata?.position || 0)).map(line => ({
    quantity: Number(line.quantity), unit: line.unit || '', name: line.name,
    description: line.description || '', unitPrice: Number(line.discountedUnitPrice ?? line.unitPrice), amount: Number(line.lineTotal),
  })) : [{ quantity: 1, unit: 'billing', name: `Partial billing for order ${order.orderNumber}`, description: 'Deposit / milestone portion of this order.', unitPrice: sales, amount: sales }];
  return {
    version: 1,
    seller: { name: organization.legalName || organization.name, address: address(organization), taxId: organization.taxId || '', phone: organization.phone || '' },
    buyer: { name: field('soldTo', customer?.legalName || customer?.name), address: field('address', order.billingAddress || address(customer), 2000), taxId: field('taxId', customer?.taxId, 80), businessStyle: field('businessStyle', customer?.legalName || customer?.name) },
    terms: field('terms', order.workflow?.paymentTermsDays === 0 ? 'Cash' : `${order.workflow?.paymentTermsDays ?? 30} days`, 120),
    oscaPwdId: field('oscaPwdId', '', 100), orderNumber: order.orderNumber, items,
    partial: !fullOrder, grossSales: sales, tax, netSales: W.money(sales - tax),
    // The current order workflow has no exempt/zero-rated classification.
    // Unknown categories stay blank rather than inventing a tax treatment.
    vatableSales: tax > 0 ? W.money(sales - tax) : null, vatExemptSales: null, zeroRatedSales: null,
    scPwdDiscount: 0, shipping, roundingAdjustment, withholding: Number(invoice.withHoldingTaxAmount), total: Number(invoice.totalAmount),
  };
}
module.exports = { buildInvoiceDocument };
