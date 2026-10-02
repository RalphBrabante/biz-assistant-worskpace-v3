const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function paidInvoice(invoice) {
  return invoice.status !== 'void' && !['refunded', 'failed'].includes(invoice.paymentStatus)
    && (invoice.status === 'paid' || invoice.paymentStatus === 'paid');
}

function invoicePaymentSummary(order, invoices) {
  const active = invoices.filter(invoice => invoice.status !== 'void');
  const paidInvoices = active.filter(paidInvoice);
  const paid = money(paidInvoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount), 0));
  const paymentStatus = paid > 0 && paid >= money(order.totalAmount) ? 'paid'
    : paid > 0 || active.some(invoice => invoice.status === 'partially_paid' || invoice.paymentStatus === 'partially_paid') ? 'partially_paid'
    : active.some(invoice => invoice.paymentStatus === 'refunded') ? 'refunded' : 'unpaid';
  const dates = paidInvoices.map(invoice => invoice.paidAt).filter(Boolean).map(value => new Date(value)).filter(value => Number.isFinite(value.getTime()));
  return { paid, paymentStatus, paidAt: paymentStatus === 'paid' ? order.paidAt || (dates.length ? new Date(Math.max(...dates.map(value => value.getTime()))) : new Date()) : null };
}

// Managed orders use their payment ledger. Legacy orders use linked invoice records.
async function syncLegacyOrderPayment(invoice, options = {}) {
  if (options.orderWorkflow) return;
  const { Order, SalesInvoice, OrderActivity } = invoice.sequelize.models;
  const ids = [...new Set([invoice.orderId, invoice.previous('orderId')].filter(Boolean))].sort();
  if (!ids.length) return;
  const sync = async transaction => {
    for (const id of ids) {
      const order = await Order.findOne({ where: { id, organizationId: invoice.organizationId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!order || order.workflow) continue;
      const invoices = await SalesInvoice.findAll({ where: { orderId: id, organizationId: order.organizationId, currency: order.currency }, transaction, lock: transaction.LOCK.UPDATE });
      const summary = invoicePaymentSummary(order, invoices);
      if (order.paymentStatus === summary.paymentStatus && !!order.paidAt === !!summary.paidAt) continue;
      const before = order.paymentStatus;
      await order.update({ paymentStatus: summary.paymentStatus, paidAt: summary.paidAt, revision: Number(order.revision || 0) + 1 }, { transaction });
      await OrderActivity.create({ orderId: id, organizationId: order.organizationId, userId: invoice.updatedBy || null,
        actionType: 'invoice_payment_synced', title: 'Invoice payment synchronized',
        description: `Order payment status changed from ${before} to ${summary.paymentStatus} based on linked invoices.`,
        metadata: { invoiceId: invoice.id, paidInvoiceTotal: summary.paid, from: before, to: summary.paymentStatus } }, { transaction });
    }
  };
  return options.transaction ? sync(options.transaction) : invoice.sequelize.transaction(sync);
}

module.exports = { paidInvoice, invoicePaymentSummary, syncLegacyOrderPayment };
