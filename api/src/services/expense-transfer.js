const { createHash } = require('node:crypto');
const { computeExpenseAmounts, ExpenseCalculationError } = require('./expense-calculation');
const { isVatTaxType, isPercentageTaxType } = require('./tax-calculation');

class ExpenseTransferError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const supplied = (value) => value !== undefined && value !== null && value !== '';
const code = (value) => String(value || '').trim().toUpperCase();

// Receipt VAT is an invoice fact, not the receiving company's VAT rate.
function recordedReceiptVat(expense) {
  if (supplied(expense.receiptVatAmount)) return expense.receiptVatAmount;
  if (isVatTaxType(expense.taxType) && supplied(expense.taxAmount)) return expense.taxAmount;
  return null;
}

function buildExpenseTransferPreview(expense, target, withholdingTypes, selection = {}) {
  if (!target || target.isActive === false || !target.taxTypeId || !target.taxType || target.taxType.isActive === false) {
    throw new ExpenseTransferError('Target organization must have an active tax type before transferring expenses.');
  }
  if (!isVatTaxType(target.taxType) && !isPercentageTaxType(target.taxType)) {
    throw new ExpenseTransferError('Target organization tax type is not supported for expense calculations.');
  }
  if (isVatTaxType(target.taxType) && !supplied(target.taxType.percentage)) {
    throw new ExpenseTransferError('Target VAT rate is missing. Correct the organization tax settings first.');
  }
  const currency = code(expense.currency);
  if (!currency || currency !== code(target.currency)) {
    throw new ExpenseTransferError('Expense and target organization currencies must match. A transfer cannot convert or relabel receipt amounts.');
  }
  const types = withholdingTypes.filter((type) => type.organizationId === target.id && type.isActive !== false && ['expense', 'both'].includes(type.appliesTo));
  let selected;
  if (Object.prototype.hasOwnProperty.call(selection, 'withholdingTaxTypeId')) {
    const id = String(selection.withholdingTaxTypeId || '').trim();
    selected = id ? types.find((type) => type.id === id) : null;
    if (id && !selected) throw new ExpenseTransferError('Selected withholding tax is not active for expenses in the target organization.');
  } else if (expense.withholdingTaxTypeId) {
    const matches = types.filter((type) => code(type.code) && code(type.code) === code(expense.withholdingTaxType?.code));
    if (matches.length === 1) selected = matches[0];
  } else if (Number(expense.withHoldingTaxAmount || 0) === 0) {
    selected = null;
  }
  const requiresWithholdingSelection = selected === undefined;
  if (selected && (!supplied(selected.percentage) || !supplied(selected.minimumBaseAmount))) {
    throw new ExpenseTransferError('Selected withholding tax has incomplete rate or minimum-base settings.');
  }
  const recordedVat = recordedReceiptVat(expense);
  // Only legacy receipts without a recorded split need an explicit amount from the receipt.
  const receiptVatAmount = recordedVat ?? (supplied(selection.receiptVatAmount) ? selection.receiptVatAmount : null);
  const requiresReceiptVat = receiptVatAmount === null;
  const amounts = !requiresWithholdingSelection && !requiresReceiptVat ? computeExpenseAmounts({
    amount: expense.amount, vatExemptAmount: expense.vatExemptAmount,
    receiptVatAmount, discountAmount: expense.discountAmount, serviceCharge: expense.serviceCharge,
    taxType: target.taxType, withholdingPercentage: selected?.percentage ?? 0,
    withholdingMinimumBaseAmount: selected?.minimumBaseAmount ?? 0,
  }) : null;
  const sourceFields = ['id', 'organizationId', 'updatedAt', 'currency', 'expenseNumber', 'expenseDate', 'status', 'vendorId', 'vendorTaxId', 'amount', 'vatExemptAmount', 'receiptVatAmount', 'taxAmount', 'taxTypeId', 'withholdingTaxTypeId', 'withHoldingTaxAmount', 'discountAmount', 'serviceCharge', 'totalAmount'];
  const fingerprint = {
    source: sourceFields.map((key) => expense[key] ?? null),
    target: [target.id, target.currency, target.taxTypeId, target.taxType.code, target.taxType.name, target.taxType.percentage],
    withholding: selected ? [selected.id, selected.code, selected.percentage, selected.minimumBaseAmount] : null,
    amounts,
  };
  return {
    targetOrganizationId: target.id, currency, taxType: target.taxType,
    withholdingTaxTypes: types, withholdingTaxTypeId: selected?.id ?? null,
    requiresWithholdingSelection, requiresReceiptVat, receiptVatEditable: recordedVat === null,
    receiptVatAmount, amounts, ready: Boolean(amounts),
    previewToken: amounts ? createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex') : null,
  };
}

module.exports = { buildExpenseTransferPreview, recordedReceiptVat, ExpenseTransferError, ExpenseCalculationError };
