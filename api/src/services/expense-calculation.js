const { isVatTaxType } = require('./tax-calculation');

class ExpenseCalculationError extends Error {}

// Monetary inputs are decimal strings or numbers with at most two decimal places.
// Integer centavos and integer rate units keep every persisted split exact.
function moneyCents(value, label) {
  const text = String(value ?? 0).trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) {
    throw new ExpenseCalculationError(`${label} must be a non-negative amount with at most 2 decimal places.`);
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function rateUnits(value, label) {
  const units = moneyCents(value, label);
  if (units > 10000n) throw new ExpenseCalculationError(`${label} must be between 0 and 100%.`);
  return units;
}

function divideRounded(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function computeExpenseAmounts({ amount = 0, vatExemptAmount = 0, receiptVatAmount,
  discountAmount = 0, serviceCharge = 0, taxType = {}, withholdingPercentage = 0, withholdingMinimumBaseAmount = 0 } = {}) {
  const gross = moneyCents(amount, 'Receipt total');
  const exempt = moneyCents(vatExemptAmount, 'VAT-exempt portion');
  const discount = moneyCents(discountAmount, 'Discount');
  const service = moneyCents(serviceCharge, 'Service charge');
  if (exempt > gross) throw new ExpenseCalculationError('VAT-exempt portion cannot exceed the receipt total.');
  if (service > gross) throw new ExpenseCalculationError('Service charge is already included and cannot exceed the receipt total.');
  const vatRate = isVatTaxType(taxType) ? rateUnits(taxType.percentage ?? 0, 'VAT rate') : 0n;
  const ewtRate = rateUnits(withholdingPercentage, 'Withholding rate');
  const purchaseGross = gross - exempt;
  const vat = receiptVatAmount === undefined || receiptVatAmount === null || receiptVatAmount === ''
    ? purchaseGross - divideRounded(purchaseGross * 10000n, 10000n + vatRate)
    : moneyCents(receiptVatAmount, 'Supplier VAT');
  if (vat > purchaseGross) throw new ExpenseCalculationError('Supplier VAT plus the exempt portion cannot exceed the receipt total.');
  const withholdingBase = gross - vat;
  const minimumBase = moneyCents(withholdingMinimumBaseAmount, 'Withholding minimum base');
  const withholding = withholdingBase >= minimumBase ? divideRounded(withholdingBase * ewtRate, 10000n) : 0n;
  const money = (cents) => Number(cents) / 100;
  return {
    amount: money(gross), vatExemptAmount: money(exempt), receiptVatAmount: money(vat),
    taxableAmount: money(purchaseGross - vat),
    taxAmount: isVatTaxType(taxType) ? money(vat) : 0,
    withholdingTaxBase: money(withholdingBase), withHoldingTaxAmount: money(withholding),
    // Both components are already reflected in the final invoice total.
    discountAmount: money(discount), serviceCharge: money(service), totalAmount: money(gross - withholding),
  };
}

module.exports = { computeExpenseAmounts, ExpenseCalculationError };
