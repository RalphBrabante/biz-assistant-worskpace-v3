const { isVatTaxType, isPercentageTaxType, roundCurrency } = require('./tax-calculation');
const { createHash } = require('node:crypto');

class TaxReturnError extends Error {}
const numericFields = [
  'percentageSales', 'vatableSales', 'zeroRatedSales', 'exemptSales', 'outputVat',
  'domesticPurchases', 'domesticInputVat', 'purchasesWithoutInputVat',
  'nonresidentPurchases', 'nonresidentInputVat', 'importPurchases', 'importInputVat', 'exemptImports',
  'inputCarryover', 'transitionalInput', 'presumptiveInput', 'uncollectedOutputVat', 'recoveredOutputVat',
  'exemptInputVat', 'refundInputVat', 'unpaidInputVat', 'settledInputVat',
  'creditableTax', 'advanceVat', 'previousPayment', 'otherCredits', 'surcharge', 'interest', 'compromise',
];

function section116Rate(year, quarter) {
  return (year > 2020 || (year === 2020 && quarter >= 3)) &&
    (year < 2023 || (year === 2023 && quarter <= 2)) ? 1 : 3;
}

function prepareTaxReturn(organization, invoices, expenses, year, quarter) {
  const vat = isVatTaxType(organization.taxType || {});
  const pt = isPercentageTaxType(organization.taxType || {});
  const form = vat ? '2550Q' : pt ? '2551Q' : null;
  let reason = '';
  if (!form) reason = 'Configure the organization tax type as VAT or Percentage Tax before generating a BIR return.';
  else if (String(organization.country || '').toLowerCase() !== 'philippines') reason = 'BIR returns are available for organizations registered in the Philippines.';
  else if (String(organization.currency).toUpperCase() !== 'PHP' || [...invoices, ...expenses].some(row => String(row.currency).toUpperCase() !== 'PHP')) reason = 'BIR returns require PHP records. Convert foreign-currency transactions before preparing this return.';
  else if (vat && (year < 2024 || (year === 2024 && quarter === 1))) reason = 'The April 2024 VAT template supports Q2 2024 onward. Earlier quarters require the applicable historical BIR template.';
  else if (pt && year < 2018) reason = 'The January 2018 percentage-tax template supports 2018 onward. Earlier quarters require the applicable historical BIR template.';
  else if (pt && Number(organization.taxType.percentage) !== 3) reason = 'This generator supports Section 116 percentage tax (PT010). Special industry percentage-tax returns require their applicable ATCs.';
  const defaults = Object.fromEntries(numericFields.map(key => [key, 0]));
  Object.assign(defaults, {
    tin: String(organization.taxId || ''), registeredName: organization.legalName || organization.name || '',
    registeredAddress: ['addressLine1', 'addressLine2', 'city', 'state', 'country'].map(key => organization[key]).filter(Boolean).join(', '),
    zipCode: organization.postalCode || '', phone: organization.phone || '', email: organization.contactEmail || '',
    rdoCode: organization.rdoCode || '', taxpayerSize: organization.taxpayerSize || '', amended: false,
    incomeTaxElection: pt && String(organization.taxpayerClassification) === 'individual' ? 'unconfirmed' : 'graduated',
    otherCreditsDescription: '',
  });
  let unclassifiedSales = 0;
  for (const invoice of invoices) {
    // taxableAmount is the persisted VAT-exclusive base for both legacy and order invoices.
    // subtotalAmount has different meanings across those paths and is unsuitable here.
    const base = Number(invoice.taxableAmount || 0);
    defaults.percentageSales += base;
    defaults.outputVat += Number(invoice.taxAmount || 0);
    if (Number(invoice.taxAmount) > 0) defaults.vatableSales += base;
    else unclassifiedSales += base;
  }
  for (const expense of expenses) {
    const input = Number(expense.taxAmount || 0);
    // Receipt totals already include discounts and supplier VAT; EWT is not a VAT credit.
    if (input > 0) {
      defaults.domesticPurchases += Number(expense.amount || 0) - Number(expense.receiptVatAmount ?? input);
      defaults.domesticInputVat += input;
    } else defaults.purchasesWithoutInputVat += Number(expense.amount || 0) - Number(expense.receiptVatAmount || 0);
  }
  for (const key of numericFields) defaults[key] = roundCurrency(defaults[key]);
  const sourceRevision = createHash('sha256').update(JSON.stringify([organization, invoices, expenses, year, quarter])).digest('hex');
  return { form, supported: !reason, reason, year, quarter, sourceRevision, rate: pt ? section116Rate(year, quarter) : 12,
    individual: String(organization.taxpayerClassification) === 'individual',
    possibleEightPercentElection: pt && String(organization.taxpayerClassification) === 'individual' && Number(organization.incomeTaxRate) === 8,
    unclassifiedSales: roundCurrency(unclassifiedSales), defaults };
}

function computeTaxReturn(preparation, input = {}) {
  if (!preparation.supported) throw new TaxReturnError(preparation.reason);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaxReturnError('Invalid return details.');
  const values = { ...preparation.defaults };
  for (const key of numericFields) {
    const value = input[key] ?? values[key];
    if (!/^\d{1,11}(\.\d{1,2})?$/.test(String(value))) throw new TaxReturnError(`${key} must be a non-negative PHP amount with at most two decimal places.`);
    values[key] = Number(value);
  }
  for (const key of ['tin', 'registeredName', 'registeredAddress', 'zipCode', 'phone', 'email', 'rdoCode', 'taxpayerSize', 'incomeTaxElection', 'otherCreditsDescription']) {
    values[key] = String(input[key] ?? values[key]).trim();
    if (values[key].length > (key === 'registeredAddress' ? 500 : 200)) throw new TaxReturnError(`${key} is too long.`);
  }
  const tin = values.tin.replace(/[-\s]/g, '');
  if (!/^\d{9}(\d{3}|\d{5})?$/.test(tin)) throw new TaxReturnError('Enter a valid 9-digit TIN, optionally followed by a 3- or 5-digit branch code.');
  values.tin = tin.slice(0, 9) + (tin.length === 9 ? '00000' : tin.slice(9).padStart(5, '0'));
  if (!/^\d{3}$/.test(values.rdoCode)) throw new TaxReturnError('Enter the three-digit RDO code from the Certificate of Registration.');
  if (!values.registeredName || !values.registeredAddress) throw new TaxReturnError('Registered name and address are required.');
  if (input.amended !== undefined && typeof input.amended !== 'boolean') throw new TaxReturnError('Amended return must be Yes or No.');
  values.amended = input.amended ?? false;
  if (values.previousPayment > 0 && !values.amended) throw new TaxReturnError('Previous return payment applies only to an amended return.');
  if (values.otherCredits > 0 && !values.otherCreditsDescription) throw new TaxReturnError('Specify the other credit/payment claimed.');
  // The official PDF's printed Item 59 formula adds Item 58 despite its
  // description restoring a previously deducted credit. Do not silently choose
  // a treatment for this discrepancy in a tax return.
  if (values.settledInputVat > 0) throw new TaxReturnError('Returns with recovered input VAT on settled payables (Item 58) require manual preparation: the official PDF has an inconsistent Item 59 formula.');
  if (!['graduated', 'eight_percent'].includes(values.incomeTaxElection)) throw new TaxReturnError('Confirm the annual election: graduated income tax or 8%.');
  if (preparation.form === '2551Q' && preparation.individual && values.incomeTaxElection === 'eight_percent') {
    throw new TaxReturnError('An individual who elected the 8% income tax regime is exempt from Section 116 percentage tax. Verify the annual election before preparing a 2551Q.');
  }
  if (preparation.form === '2550Q' && !['micro', 'small', 'medium', 'large'].includes(values.taxpayerSize)) throw new TaxReturnError('Select the BIR taxpayer size classification from your registration records.');
  const c = roundCurrency;
  const penalties = c(values.surcharge + values.interest + values.compromise);
  const credits = c(values.creditableTax + values.previousPayment + values.otherCredits + (preparation.form === '2550Q' ? values.advanceVat : 0));
  let taxDue;
  const computed = { penalties, credits };
  if (preparation.form === '2551Q') taxDue = c(values.percentageSales * preparation.rate / 100);
  else {
    const totalSales = c(values.vatableSales + values.zeroRatedSales + values.exemptSales);
    if (Math.abs(totalSales - preparation.defaults.percentageSales) > 0.011) throw new TaxReturnError('Allocate the recorded VAT-exclusive sales across VATable, zero-rated and exempt sales. Their total must match the quarter sales base.');
    const adjustedOutput = c(values.outputVat - values.uncollectedOutputVat + values.recoveredOutputVat);
    const priorInput = c(values.inputCarryover + values.transitionalInput + values.presumptiveInput);
    const currentInput = c(values.domesticInputVat + values.nonresidentInputVat + values.importInputVat);
    const totalPurchases = c(values.domesticPurchases + values.nonresidentPurchases + values.importPurchases + values.purchasesWithoutInputVat + values.exemptImports);
    const inputDeductions = c(values.exemptInputVat + values.refundInputVat + values.unpaidInputVat);
    const adjustedDeductions = inputDeductions;
    const allowableInput = c(priorInput + currentInput - adjustedDeductions);
    if (adjustedOutput < 0 || allowableInput < 0) throw new TaxReturnError('Adjustments cannot produce negative output VAT or negative allowable input VAT.');
    taxDue = c(adjustedOutput - allowableInput);
    Object.assign(computed, { totalSales, adjustedOutput, priorInput, currentInput, totalPurchases, inputDeductions, adjustedDeductions, allowableInput });
  }
  return { ...preparation, values, computed: { ...computed, taxDue, stillPayable: c(taxDue - credits), totalPayable: c(taxDue - credits + penalties) } };
}

module.exports = { TaxReturnError, prepareTaxReturn, computeTaxReturn, section116Rate };
