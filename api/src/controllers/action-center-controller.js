const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
const { authorize } = require('../middleware/authz');
const { isPrivilegedRequest, getAuthenticatedOrganizationId } = require('../services/request-scope');

const PAGE_SIZE = 5;

async function getActionCenter(req, res) {
  const kind = req.query.kind;
  if (!['invoices', 'expenses'].includes(kind)) {
    return res.status(400).json({ ok: false, message: 'kind must be invoices or expenses.' });
  }
  // Dashboard access alone must never expose financial records.
  let allowed = false;
  authorize(kind === 'invoices' ? 'sales_invoices.read' : 'expenses.read')(req, res, () => { allowed = true; });
  if (!allowed) return;
  try {
    const organizationId = isPrivilegedRequest(req)
      ? String(req.query.organizationId || '').trim()
      : getAuthenticatedOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ ok: false, message: 'Select an organization to view its Action Center.' });
    }
    const page = Number(req.query.page || 1);
    // DATEONLY deadlines use the viewer's calendar date, supplied by the dashboard.
    const today = req.query.today || new Date().toISOString().slice(0, 10);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
        !Number.isFinite(Date.parse(today)) || new Date(today).toISOString().slice(0, 10) !== today) {
      return res.status(400).json({ ok: false, message: 'Provide a valid page and calendar date (YYYY-MM-DD).' });
    }
    const models = getModels();
    const model = kind === 'invoices' ? models?.SalesInvoice : models?.Expense;
    if (!model) return res.status(503).json({ ok: false, message: 'Database models are not ready yet.' });
    const invoice = kind === 'invoices';
    const where = invoice ? {
      organizationId,
      dueDate: { [Op.lt]: today },
      status: { [Op.in]: ['issued', 'sent', 'partially_paid', 'overdue'] },
      paymentStatus: { [Op.in]: ['unpaid', 'partially_paid', 'failed'] },
      paidAt: null,
    } : { organizationId, status: 'submitted' };
    const { rows, count } = await model.findAndCountAll({
      where,
      attributes: invoice
        ? ['id', 'invoiceNumber', 'dueDate', 'totalAmount', 'currency', 'paymentStatus']
        : ['id', 'expenseNumber', 'expenseDate', 'totalAmount', 'currency'],
      include: invoice ? [{
        association: 'order', attributes: ['id'], required: false,
        include: [{ association: 'customer', attributes: ['name'], required: false }],
      }] : [{ association: 'vendor', attributes: ['name'], required: false }],
      order: [[invoice ? 'dueDate' : 'expenseDate', 'ASC'], ['id', 'ASC']],
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    return res.json({ ok: true, data: {
      kind, page, pageSize: PAGE_SIZE, total: count, today,
      rows: rows.map(record => {
        const row = record.toJSON();
        return {
          id: row.id,
          reference: (invoice ? row.invoiceNumber : row.expenseNumber) || 'No reference',
          party: (invoice ? row.order?.customer?.name : row.vendor?.name) || (invoice ? 'No linked customer' : 'No linked vendor'),
          date: invoice ? row.dueDate : row.expenseDate,
          daysOverdue: invoice ? Math.round((Date.parse(today) - Date.parse(row.dueDate)) / 86400000) : null,
          totalAmount: Number(row.totalAmount),
          currency: row.currency,
          partiallyPaid: invoice && row.paymentStatus === 'partially_paid',
        };
      }),
    } });
  } catch (err) {
    console.error('[dashboard] getActionCenter error:', err);
    return res.status(500).json({ ok: false, message: 'Unable to load actions. Please try again.' });
  }
}

module.exports = { getActionCenter };
