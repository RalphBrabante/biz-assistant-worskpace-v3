const { Op, fn, col, literal } = require('sequelize');
const { getModels } = require('../sequelize');
const { getOrganizationCurrency } = require('../services/organization-currency');
const {
  isPrivilegedRequest,
  getAuthenticatedOrganizationId,
} = require('../services/request-scope');

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return null;
  }
  return year;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function getMonthlySummary(req, res) {
  try {
    const models = getModels();
    if (!models || !models.SalesInvoice || !models.Expense) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const year = parseYear(req.query.year || new Date().getFullYear());
    if (year === null) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'year must be a valid integer between 2000 and 2100.',
      });
    }

    const privileged = isPrivilegedRequest(req);
    const authOrgId = getAuthenticatedOrganizationId(req);
    const requestedOrgId = req.query.organizationId
      ? String(req.query.organizationId).trim()
      : null;

    // Non-privileged users are always scoped to their org.
    const organizationId = privileged
      ? (requestedOrgId || null)
      : authOrgId;

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    const salesWhere = {
      issueDate: { [Op.between]: [yearStart, yearEnd] },
      status: { [Op.ne]: 'void' },
    };
    if (organizationId) {
      salesWhere.organizationId = organizationId;
    }

    const expenseWhere = {
      expenseDate: { [Op.between]: [yearStart, yearEnd] },
    };
    if (organizationId) {
      expenseWhere.organizationId = organizationId;
    }

    const [salesRows, expenseRows] = await Promise.all([
      models.SalesInvoice.findAll({
        where: salesWhere,
        attributes: [
          [fn('MONTH', col('issue_date')), 'month'],
          [fn('COALESCE', fn('SUM', col('total_amount')), 0), 'total'],
        ],
        group: [literal('MONTH(issue_date)')],
        order: [[literal('MONTH(issue_date)'), 'ASC']],
        raw: true,
      }),
      models.Expense.findAll({
        where: expenseWhere,
        attributes: [
          [fn('MONTH', col('expense_date')), 'month'],
          [fn('COALESCE', fn('SUM', col('total_amount')), 0), 'total'],
        ],
        group: [literal('MONTH(expense_date)')],
        order: [[literal('MONTH(expense_date)'), 'ASC']],
        raw: true,
      }),
    ]);

    const salesByMonth = {};
    for (const row of salesRows) {
      salesByMonth[Number(row.month)] = toNumber(row.total);
    }

    const expensesByMonth = {};
    for (const row of expenseRows) {
      expensesByMonth[Number(row.month)] = toNumber(row.total);
    }

    const months = MONTH_NAMES.map((name, index) => {
      const m = index + 1;
      return {
        month: m,
        monthName: name,
        sales: salesByMonth[m] || 0,
        expenses: expensesByMonth[m] || 0,
      };
    });

    const totalSales = months.reduce((sum, m) => sum + m.sales, 0);
    const totalExpenses = months.reduce((sum, m) => sum + m.expenses, 0);

    const currency = organizationId
      ? await getOrganizationCurrency(organizationId)
      : 'USD';

    return res.json({
      ok: true,
      data: {
        year,
        currency,
        totalSales,
        totalExpenses,
        months,
      },
    });
  } catch (err) {
    console.error('[dashboard] getMonthlySummary error:', err);
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to load monthly summary.',
    });
  }
}

module.exports = { getMonthlySummary };
