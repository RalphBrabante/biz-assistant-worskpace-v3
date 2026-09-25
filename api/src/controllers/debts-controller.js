const {Op, col, fn, literal, where: sqlWhere} = require('sequelize');
const {getModels} = require('../sequelize');
const {isPrivilegedRequest} = require('../services/request-scope');
const {fail, cents, money, positive, debtView} = require('../services/debt-amounts');
function scope(req) {
  const id = isPrivilegedRequest(req) ? req.query.organizationId : req.auth?.user?.organizationId;
  if (typeof id !== 'string' || !id.trim() || id.length > 36) throw fail(400, 'Select an organization to manage debts.');
  return {organizationId: id};
}
function text(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(400, `Enter a valid ${label} (up to ${max} characters).`);
  return value.trim();
}
function date(value, label, optional = false) {
  if (optional && !value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw fail(400, `Enter a valid ${label}.`);
  return value;
}
function requestKey(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) throw fail(400, 'A valid request key is required.');
  return value;
}
function page(value) { const n = Number(value || 1); if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw fail(400, 'Invalid page.'); return n; }
function endpoint(handler) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { await handler(req, res); }
    catch (error) { if (!error.status) console.error('[debts]', error.name); res.status(error.status || 500).json({message: error.status ? error.message : 'Unable to complete this debt action. Please retry.'}); }
  };
}
async function debtFor(models, req, transaction) {
  const debt = await models.Debt.findOne({where: {...scope(req), id: req.params.id}, transaction, ...(transaction ? {lock: transaction.LOCK.UPDATE} : {})});
  if (!debt) throw fail(404, 'Debt not found.');
  return debt;
}
const list = endpoint(async (req, res) => {
  const models = getModels(), where = scope(req), currentPage = page(req.query.page);
  if (req.query.q) { const q = text(req.query.q, 'search', 200); where[Op.or] = [{title: {[Op.like]: `%${q}%`}}, {creditor: {[Op.like]: `%${q}%`}}]; }
  if (req.query.status) {
    if (!['outstanding', 'paid'].includes(req.query.status)) throw fail(400, 'Invalid debt status.');
    where[Op.and] = sqlWhere(col('paid_amount'), req.query.status === 'paid' ? Op.eq : Op.lt, col('original_amount'));
  }
  const organization = await models.Organization.findByPk(where.organizationId, {attributes: ['id', 'currency']});
  if (!organization) throw fail(404, 'Organization not found.');
  const {rows, count} = await models.Debt.findAndCountAll({where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 25, offset: (currentPage - 1) * 25});
  const totals = await models.Debt.findAll({where, attributes: ['currency', [fn('SUM', col('original_amount')), 'originalAmount'], [fn('SUM', col('paid_amount')), 'paidAmount'], [fn('SUM', literal('`original_amount` - `paid_amount`')), 'remainingAmount']], group: ['currency'], raw: true});
  return res.json({data: {debts: rows.map(debtView), currency: organization.currency || 'PHP', summary: totals}, meta: {page: currentPage, total: count, totalPages: Math.ceil(count / 25)}});
});
const detail = endpoint(async (req, res) => {
  const models = getModels(), currentPage = page(req.query.page);
  const result = await models.Debt.sequelize.transaction(async transaction => {
    // Serialize briefly with payment writes so the balance and history agree.
    const debt = await debtFor(models, req, transaction);
    const {rows, count} = await models.DebtPayment.findAndCountAll({where: {organizationId: debt.organizationId, debtId: debt.id}, include: [{association: 'author', attributes: ['firstName', 'lastName']}], order: [['paidOn', 'DESC'], ['createdAt', 'DESC'], ['id', 'DESC']], limit: 20, offset: (currentPage - 1) * 20, transaction});
    return {debt: debtView(debt), payments: rows, count};
  });
  return res.json({data: {debt: result.debt, payments: result.payments}, meta: {page: currentPage, total: result.count, totalPages: Math.ceil(result.count / 20)}});
});
const create = endpoint(async (req, res) => {
  const models = getModels(), {organizationId} = scope(req), body = req.body || {};
  const values = {title: text(body.title, 'debt name', 200, true), creditor: text(body.creditor, 'creditor', 200, true), originalAmount: positive(body.amount, 'Debt amount'), borrowedOn: date(body.borrowedOn, 'debt date'), dueOn: date(body.dueOn, 'due date', true), notes: text(body.notes, 'notes', 5000), requestKey: requestKey(body.requestKey)};
  if (values.dueOn && values.dueOn < values.borrowedOn) throw fail(400, 'Due date cannot be before the debt date.');
  let repeated = false;
  const debt = await models.Debt.sequelize.transaction(async transaction => {
    const org = await models.Organization.findByPk(organizationId, {transaction, lock: transaction.LOCK.UPDATE});
    if (!org) throw fail(404, 'Organization not found.');
    const existing = await models.Debt.findOne({where: {organizationId, requestKey: values.requestKey}, transaction});
    if (existing) {
      if (Object.entries(values).some(([key, value]) => String(existing[key] ?? '') !== String(value ?? ''))) throw fail(409, 'This request was already used for a different debt. Refresh before adding another.');
      repeated = true; return existing;
    }
    const currency = String(org.currency || 'PHP').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw fail(400, 'Set a valid organization currency first.');
    return models.Debt.create({...values, organizationId, currency, paidAmount: '0.00', createdBy: req.auth.userId}, {transaction});
  });
  return res.status(repeated ? 200 : 201).json({data: debtView(debt)});
});
const pay = endpoint(async (req, res) => {
  const models = getModels(), body = req.body || {};
  const values = {amount: positive(body.amount, 'Payment amount'), paidOn: date(body.paidOn, 'payment date'), reference: text(body.reference, 'reference', 200), notes: text(body.notes, 'notes', 5000), requestKey: requestKey(body.requestKey)};
  let repeated = false;
  const result = await models.Debt.sequelize.transaction(async transaction => {
    const debt = await debtFor(models, req, transaction);
    const existing = await models.DebtPayment.findOne({where: {debtId: debt.id, organizationId: debt.organizationId, requestKey: values.requestKey}, transaction});
    if (existing) {
      if (Object.entries(values).some(([key, value]) => String(existing[key] ?? '') !== String(value ?? ''))) throw fail(409, 'This request was already used for a different payment. Reload the debt to check its payment history.');
      repeated = true; return {debt: debtView(debt), payment: existing};
    }
    if (values.paidOn < debt.borrowedOn) throw fail(400, 'Payment date cannot be before the debt date.');
    const paid = cents(debt.paidAmount), amount = cents(values.amount), remaining = cents(debt.originalAmount) - paid;
    if (amount > remaining) throw fail(409, `Payment exceeds the remaining balance of ${money(remaining)} ${debt.currency}. Reload the debt to see its latest balance.`);
    const payment = await models.DebtPayment.create({...values, debtId: debt.id, organizationId: debt.organizationId, createdBy: req.auth.userId}, {transaction});
    await debt.update({paidAmount: money(paid + amount)}, {transaction});
    return {debt: debtView(debt), payment};
  });
  return res.status(repeated ? 200 : 201).json({data: result, message: 'Payment recorded. Remaining balance updated.'});
});
module.exports = {scope, list, detail, create, pay};
