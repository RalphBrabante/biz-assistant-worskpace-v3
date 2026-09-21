function normalizeTaxCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTaxText(value) {
  return String(value || '').trim().toUpperCase();
}

function isPercentageTaxType(taxType = {}) {
  const code = normalizeTaxCode(taxType.code);
  const name = normalizeTaxText(taxType.name);
  const description = normalizeTaxText(taxType.description);
  return (
    code === 'PT' ||
    code === 'PERCENTAGE_TAX' ||
    code === 'PERCENTAGE' ||
    code === 'NONVAT' ||
    code === 'NON_VAT' ||
    name.includes('PERCENTAGE TAX') ||
    name.includes('NON-VAT') ||
    name.includes('NON VAT') ||
    description.includes('PERCENTAGE TAX') ||
    description.includes('NON-VAT') ||
    description.includes('NON VAT')
  );
}

function isVatTaxType(taxType = {}) {
  if (isPercentageTaxType(taxType)) {
    return false;
  }
  const code = normalizeTaxCode(taxType.code);
  const name = normalizeTaxText(taxType.name);
  return code === 'VAT' || name === 'VAT' || name.includes('VALUE ADDED TAX');
}

function roundCurrency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function resolveTaxMode(taxType = {}) {
  if (isPercentageTaxType(taxType)) {
    return 'PT';
  }
  if (isVatTaxType(taxType)) {
    return 'VAT';
  }
  return normalizeTaxCode(taxType.code) || 'NONE';
}

module.exports = {
  isPercentageTaxType,
  isVatTaxType,
  normalizeTaxCode,
  resolveTaxMode,
  roundCurrency,
};
