const { Op, fn, col } = require('sequelize');

async function quarterlyExpenseTotals(Expense, organizationId, periodStart, periodEnd, transaction) {
  const totals = await Expense.findOne({
    where: { organizationId, expenseDate: { [Op.between]: [periodStart, periodEnd] }, status: { [Op.ne]: 'cancelled' } },
    attributes: [
      [fn('COUNT', col('id')), 'expenseCount'],
      ...[['amount', 'amount'], ['tax_amount', 'taxAmount'], ['discount_amount', 'discountAmount'], ['total_amount', 'totalAmount']]
        .map(([column, name]) => [fn('COALESCE', fn('SUM', col(column)), 0), name]),
    ],
    raw: true, transaction,
  });
  // Keep SQL DECIMAL sums as decimal strings; do not add money using binary floats.
  return {
    expenseCount: Number(totals?.expenseCount || 0), amount: totals?.amount ?? '0.00',
    taxAmount: totals?.taxAmount ?? '0.00', discountAmount: totals?.discountAmount ?? '0.00',
    totalAmount: totals?.totalAmount ?? '0.00',
  };
}

async function refreshTransferredExpenseReports(models, organizationIds, expenseDate, actorId, transaction) {
  const reports = await models.QuarterlyExpenseReport.findAll({
    where: { organizationId: { [Op.in]: organizationIds }, periodStart: { [Op.lte]: expenseDate }, periodEnd: { [Op.gte]: expenseDate } },
    order: [['organizationId', 'ASC'], ['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
  });
  for (const report of reports) {
    await report.update({
      ...await quarterlyExpenseTotals(models.Expense, report.organizationId, report.periodStart, report.periodEnd, transaction),
      generatedAt: new Date(), generatedBy: actorId,
    }, { transaction });
  }
}
module.exports = { quarterlyExpenseTotals, refreshTransferredExpenseReports };
