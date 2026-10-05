const { createHash } = require('node:crypto');
const { TaxReturnError, prepareTaxReturn } = require('./bir-tax-return');
const { isVatTaxType, isPercentageTaxType, roundCurrency } = require('./tax-calculation');

const plain = row => row.toJSON ? row.toJSON() : row;
const amount = value => Number(value || 0);
const sum = (rows, read) => roundCurrency(rows.reduce((total, row) => total + read(row), 0));
const address = party => ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'].map(key => party?.[key]).filter(Boolean).join(', ');
const field = (key, label, type = 'amount', extra = {}) => ({ key, label, type, group: 'income', ...extra });
const options = (...pairs) => pairs.map(([value, label]) => ({ value, label }));
const identityFields = [
  field('tin', 'TIN and branch code', 'text', { group: 'identity' }),
  field('rdoCode', 'RDO code (3 digits)', 'text', { group: 'identity' }),
  field('registeredName', 'Registered taxpayer name', 'text', { group: 'identity' }),
  field('registeredAddress', 'Registered address', 'text', { group: 'identity' }),
  field('zipCode', 'ZIP code', 'text', { group: 'identity' }),
  field('phone', 'Contact number', 'text', { group: 'identity' }),
  field('email', 'Email address', 'text', { group: 'identity' }),
];
const creditFields = [
  field('priorYearCredits', "Prior year's excess credits", 'amount', { group: 'credits' }),
  field('priorPayments', 'Income tax paid in previous quarters', 'amount', { group: 'credits' }),
  field('priorWithholding', 'Verified 2307 credits from previous quarters', 'amount', { group: 'credits' }),
  field('currentWithholding', 'Verified 2307 credits for this quarter', 'amount', { group: 'credits' }),
  field('previousPayment', 'Payment on the return being amended', 'amount', { group: 'credits' }),
  field('otherCredits', 'Other credits/payments', 'amount', { group: 'credits' }),
  field('otherCreditsDescription', 'Description of other credits', 'text', { group: 'credits' }),
  field('surcharge', 'Surcharge', 'amount', { group: 'credits' }),
  field('interest', 'Interest', 'amount', { group: 'credits' }),
  field('compromise', 'Compromise penalty', 'amount', { group: 'credits' }),
];

function period(year, quarter, annual = false) {
  const first = annual ? 1 : (quarter - 1) * 3 + 1;
  const last = annual ? 12 : quarter * 3;
  return { year, quarter: annual ? null : quarter, annual,
    periodStart: `${year}-${String(first).padStart(2, '0')}-01`,
    periodEnd: new Date(Date.UTC(year, last, 0)).toISOString().slice(0, 10),
    periodLabel: annual ? `Annual ${year} · January–December` : `Q${quarter} ${year} · ${['January–March', 'April–June', 'July–September', 'October–December'][quarter - 1]}` };
}

function graduatedTax(income, year) {
  const n = Math.max(0, income);
  const bands = year >= 2023
    ? [[8000000, 2202500, .35], [2000000, 402500, .30], [800000, 102500, .25], [400000, 22500, .20], [250000, 0, .15]]
    : [[8000000, 2410000, .35], [2000000, 490000, .32], [800000, 130000, .30], [400000, 30000, .25], [250000, 0, .20]];
  const band = bands.find(([floor]) => n > floor);
  return band ? Math.round(band[1] + (n - band[0]) * band[2]) : 0;
}

function normalizeTin(value) {
  const tin = String(value || '').replace(/[-\s]/g, '');
  if (!/^\d{9}(\d{3}|\d{5})?$/.test(tin)) throw new TaxReturnError('Enter a valid 9-digit TIN, optionally followed by a 3- or 5-digit branch code.');
  return tin.slice(0, 9) + (tin.length === 9 ? '00000' : tin.slice(9).padStart(5, '0'));
}

function prepareReportDocuments(organization, invoiceRows, expenseRows, year, quarter) {
  const org = plain(organization);
  const invoices = invoiceRows.map(plain).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const expenses = expenseRows.map(plain).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const q = period(year, quarter), annual = period(year, quarter, true);
  const inPeriod = (rows, key, p) => rows.filter(row => String(row[key]).slice(0, 10) >= p.periodStart && String(row[key]).slice(0, 10) <= p.periodEnd);
  const quarterInvoices = inPeriod(invoices, 'issueDate', q), quarterExpenses = inPeriod(expenses, 'expenseDate', q);
  const beforeInvoices = invoices.filter(row => String(row.issueDate).slice(0, 10) < q.periodStart);
  const beforeExpenses = expenses.filter(row => String(row.expenseDate).slice(0, 10) < q.periodStart);
  const vat = isVatTaxType(org.taxType || {});
  const expenseBase = row => amount(row.amount) - (vat ? amount(row.taxAmount) : 0);
  const sales = rows => sum(rows, row => amount(row.taxableAmount));
  const costs = rows => sum(rows, expenseBase);
  const withheld = rows => sum(rows, row => amount(row.withHoldingTaxAmount));
  const individual = ['individual', 'estate_trust'].includes(org.taxpayerClassification);
  const corporation = org.taxpayerClassification === 'corporation';
  const identity = prepareTaxReturn(org, [], [], year, quarter).defaults;
  const defaults = Object.fromEntries(identityFields.map(({ key }) => [key, identity[key]]));
  const docs = [];
  function add(id, title, category, p, sourceInvoices, sourceExpenses, extra = {}) {
    let reason = '';
    if (String(org.country || '').toLowerCase() !== 'philippines') reason = 'Available for organizations registered in the Philippines.';
    else if (String(org.currency).toUpperCase() !== 'PHP' || [...sourceInvoices, ...sourceExpenses].some(row => String(row.currency).toUpperCase() !== 'PHP')) reason = 'PHP records are required. Convert foreign-currency transactions before preparing this document.';
    if (extra.reason) reason = extra.reason;
    const sourceRevision = createHash('sha256').update(JSON.stringify([org, sourceInvoices, sourceExpenses, id, p])).digest('hex');
    const doc = { id, title, category, ...p, supported: !reason, reason, sourceRevision,
      fields: [], defaults: { ...defaults }, description: '', warnings: [], ...extra };
    // Availability is determined on the server, including currency restrictions.
    doc.supported = !reason; doc.reason = reason;
    docs.push(doc);
    return doc;
  }
  const incomeDefaults = () => {
    const osd = org.deductionMethod === 'osd';
    return { ...defaults, sales: sales(quarterInvoices), costSales: 0, deductions: costs(quarterExpenses),
      priorIncome: osd ? roundCurrency(sales(beforeInvoices) * .6) : roundCurrency(sales(beforeInvoices) - costs(beforeExpenses)),
      priorGrossIncome: sales(beforeInvoices), otherIncome: 0, otherIncomeDescription: '', gppIncome: 0,
      incomeTaxElection: 'unconfirmed', deductionMethod: org.deductionMethod || 'itemized', activity: org.taxpayerClassification === 'estate_trust' ? 'estate' : 'business',
      mixedIncome: false, amended: false, dateOfBirth: '', citizenship: '', civilStatus: '',
      priorYearCredits: 0, priorPayments: 0, priorWithholding: withheld(beforeInvoices),
      currentWithholding: withheld(quarterInvoices),
      previousPayment: 0, otherCredits: 0, otherCreditsDescription: '', surcharge: 0, interest: 0, compromise: 0,
      reviewedAmounts: false, verifiedCredits: false, calendarYear: false, eightPercentEligible: false,
      corporateRate: '', totalAssets: 0, eligibleSmallCorporation: false, commencementYear: '',
      grossIncomeQ1: sales(inPeriod(invoices, 'issueDate', period(year, 1))),
      grossIncomeQ2: quarter >= 2 ? sales(inPeriod(invoices, 'issueDate', period(year, 2))) : 0,
      grossIncomeQ3: quarter >= 3 ? sales(inPeriod(invoices, 'issueDate', period(year, 3))) : 0,
      priorMcitPayments: 0, excessMcitCredit: 0,
    };
  };
  const incomeFields = [field('sales', 'Sales for the covered period, excluding VAT'), field('costSales', 'Cost of sales/services (separate from operating deductions)'),
    field('deductions', 'Allowable operating deductions (exclude cost of sales)'),
    field('otherIncome', 'Other taxable income for the covered period'), field('otherIncomeDescription', 'Description of other taxable income', 'text'),
    field('priorIncome', 'Taxable income/(loss) from previously filed quarters', 'signedAmount'),
    field('verifiedCredits', 'I verified the claimed withholding credits against received BIR 2307 certificates.', 'checkbox', { group: 'review' }),
    field('reviewedAmounts', 'I reviewed sales, cost allocation, deductions and prior-quarter figures against the books and filed returns.', 'checkbox', { required: true, group: 'review' }),
    field('amended', 'Amended return', 'checkbox', { group: 'credits' }), ...creditFields];
  const individualFields = [
    field('incomeTaxElection', 'Income tax election for this year', 'select', { options: options(['unconfirmed', 'Select the annual election'], ['graduated', 'Graduated rates'], ['eight_percent', '8% (eligible non-VAT individuals)']) }),
    field('deductionMethod', 'Annual deduction method', 'select', { options: options(['itemized', 'Itemized deductions'], ['osd', 'OSD: 40% of gross sales']) }),
    field('activity', 'Business / profession', 'select', { options: org.taxpayerClassification === 'estate_trust' ? options(['estate', 'Estate'], ['trust', 'Trust']) : options(['business', 'Business'], ['profession', 'Profession']) }),
    field('mixedIncome', 'Also earns compensation income (no ₱250,000 reduction under 8%)', 'checkbox'),
    field('eightPercentEligible', 'I confirmed eligibility and a valid 8% election for this tax year.', 'checkbox'),
    field('dateOfBirth', 'Date of birth', 'date', { group: 'identity' }), field('citizenship', 'Citizenship', 'text', { group: 'identity' }),
    field('civilStatus', 'Civil status / spouse scope', 'select', { group: 'identity', options: options(['', 'Select'], ['single', 'Single'], ['married_no_income', 'Married; spouse has no income'], ['separated', 'Legally separated'], ['widowed', 'Widow / widower'], ['estate_trust', 'Not applicable: estate/trust']) }),
    field('gppIncome', 'Share in income from a general professional partnership'),
    field('priorGrossIncome', '8% only: cumulative gross sales and other income in previous quarters', 'signedAmount'),
  ];
  add('1701Q', 'BIR 1701Q', 'Income tax returns', q, invoices.filter(row => String(row.issueDate).slice(0, 10) <= q.periodEnd), expenses.filter(row => String(row.expenseDate).slice(0, 10) <= q.periodEnd), {
    reason: !individual ? 'For individuals, estates and trusts. Configure the taxpayer classification to use this return.' : quarter === 4 ? 'There is no Q4 1701Q. Prepare the annual income tax return for the full year.' : year < 2018 ? 'This template supports 2018 onward.' : org.isIncomeTaxExempt ? 'Exempt and special tax regimes require separate preparation.' : '',
    description: 'Individual quarterly income tax · Q1–Q3 · cumulative income and credits',
    organizationTaxType: org.taxType || {}, recordedCumulativeSales: sales(invoices.filter(row => String(row.issueDate).slice(0, 10) <= q.periodEnd)),
    defaults: incomeDefaults(), fields: [...identityFields, ...individualFields, ...incomeFields],
    warnings: ['Prior-quarter suggestions come from records, not filed returns. Review the cumulative amount, especially when changing the annual deduction method.', 'This draft covers one filer without spouse income. Spouse income and foreign tax credits require separate preparation.', 'Compensation income is declared in the annual return, not this quarterly return.'],
  });
  const corporateFields = [
    field('calendarYear', 'This organization uses a calendar taxable year (January–December).', 'checkbox', { required: true }),
    field('corporateRate', 'Regular domestic corporate income tax rate', 'select', { options: options(['', 'Select the applicable rate'], ['25', '25% — general domestic corporation'], ['20', '20% — qualifying small domestic corporation']) }),
    field('totalAssets', 'Total assets, excluding qualifying business land'),
    field('eligibleSmallCorporation', 'For 20%: annual net taxable income ≤ ₱5M and qualifying total assets ≤ ₱100M.', 'checkbox'),
    field('commencementYear', 'Year business operations commenced', 'year'),
    field('deductionMethod', 'Annual deduction method', 'select', { options: options(['itemized', 'Itemized deductions'], ['osd', 'OSD: 40% of gross income']) }),
    ...[1, 2, 3].filter(value => value <= quarter).map(value => field(`grossIncomeQ${value}`, `MCIT gross income Q${value} (sales less cost of sales, plus applicable other income)`)),
    field('priorMcitPayments', 'MCIT payments in previous quarters', 'amount', { group: 'credits' }),
    field('excessMcitCredit', 'Verified, unexpired prior-year excess MCIT', 'amount', { group: 'credits' }),
  ];
  add('1702Q', 'BIR 1702Q', 'Income tax returns', q, invoices.filter(row => String(row.issueDate).slice(0, 10) <= q.periodEnd), expenses.filter(row => String(row.expenseDate).slice(0, 10) <= q.periodEnd), {
    reason: !corporation ? 'This generator covers ordinary domestic corporations. Partnerships, foreign corporations and special regimes require separate preparation.' : quarter === 4 ? 'There is no Q4 1702Q. The annual corporate return covers the full taxable year.' : year < 2024 || year > 2099 ? 'Historical and transitional CREATE rates require separate preparation. This generator covers calendar years 2024–2099.' : org.isIncomeTaxExempt ? 'Exempt and special tax regimes require separate preparation.' : '',
    description: 'Domestic corporate quarterly income tax · Q1–Q3 · regular tax / MCIT',
    defaults: incomeDefaults(), fields: [...identityFields, ...corporateFields, ...incomeFields],
    warnings: ['Calendar-year, ordinary domestic corporations only. Confirm registration, commencement year and applicable CREATE rate.', 'MCIT starts in the fourth taxable year immediately following the year operations commenced. The current rate is 2%. Review each quarter’s gross income; operating deductions do not reduce MCIT.', 'The official January 2018 guide prints pre-CREATE rates. The populated computation uses your confirmed current 20% or 25% rate.'],
  });
  add('1701', 'BIR 1701 / 1701A', 'Annual returns', annual, invoices, expenses, {
    reason: 'Annual individual returns cover January–December. Use 1701Q for Q1–Q3; there is no Q4 quarterly income-tax return.',
    description: 'Annual individual income tax · full calendar year',
    officialUrl: 'https://www.bir.gov.ph/bir-forms?tab=Income+Tax+Return',
  });

  const qWithholding = quarterExpenses.filter(row => amount(row.withHoldingTaxAmount) > 0);
  const atcFields = [...new Map(qWithholding.map(row => [row.withholdingTaxTypeId || 'missing', row.withholdingTaxType || {}])).entries()].map(([id, type]) => field(`atc_${id}`, `EWT ATC: ${type.name || type.code || 'Unclassified withholding'}`, 'text', { group: 'income' }));
  const atcDefaults = Object.fromEntries(qWithholding.map(row => [`atc_${row.withholdingTaxTypeId || 'missing'}`, row.withholdingTaxType?.code || '']));
  add('1601EQ', 'BIR 1601-EQ', 'Withholding documents', q, [], quarterExpenses, {
    reason: year < 2019 ? 'The January 2019 template supports 2019 onward.' : '',
    description: 'Quarterly expanded withholding remittance · taxes withheld from suppliers',
    defaults: { ...defaults, ...atcDefaults, amended: false, agentCategory: 'private', firstMonthRemittance: 0, secondMonthRemittance: 0, previousPayment: 0, overRemittance: 0, otherCredits: 0, surcharge: 0, interest: 0, compromise: 0, reviewedAmounts: false },
    fields: [...identityFields, ...atcFields,
      field('agentCategory', 'Category of withholding agent', 'select', { options: options(['private', 'Private'], ['government', 'Government']) }),
      field('amended', 'Amended return', 'checkbox'),
      ...['firstMonthRemittance', 'secondMonthRemittance', 'previousPayment', 'overRemittance', 'otherCredits', 'surcharge', 'interest', 'compromise'].map(key => field(key, { firstMonthRemittance: '0619-E / other remittance: first month', secondMonthRemittance: '0619-E / other remittance: second month', previousPayment: 'Payment on the return being amended', overRemittance: 'Over-remittance from previous quarter in the same year', otherCredits: 'Other payments (attach 0605 proof)' }[key] || key, 'amount', { group: 'credits' })),
    field('reviewedAmounts', 'I verified the EWT ATCs, tax bases, withholding amounts and remittances.', 'checkbox', { required: true, group: 'review' })],
    warnings: ['Expanded income-tax withholding only (WI/WC ATCs). Final withholding and business-tax withholding require their own returns.', 'Monthly remittances are entered separately; expenses do not prove that tax was remitted.'],
  });
  const recipients = [...new Map(qWithholding.map(row => {
    const vendor = row.vendor || {};
    const key = row.vendorId || `${row.vendorTaxId || ''}:${vendor.name || row.description || row.id}`;
    return [key, { key, name: vendor.legalName || vendor.name || 'Unclassified supplier', tin: vendor.taxId || row.vendorTaxId || '', address: address(vendor), zip: vendor.postalCode || '' }];
  })).values()].sort((a, b) => a.name.localeCompare(b.name));
  const recipient = recipients[0] || {};
  add('2307', 'BIR 2307', 'Withholding documents', q, [], quarterExpenses, {
    reason: !recipients.length ? 'No expanded withholding recorded for suppliers in this quarter.' : '',
    description: 'Certificate issued to a supplier · monthly income bases within the selected quarter', recipients,
    defaults: { ...defaults, ...atcDefaults, recipientKey: recipient.key || '', payeeName: recipient.name || '', payeeTin: recipient.tin || '', payeeAddress: recipient.address || '', payeeZip: recipient.zip || '', reviewedAmounts: false },
    fields: [...identityFields.filter(f => !['rdoCode', 'phone', 'email'].includes(f.key)),
      field('recipientKey', 'Certificate recipient', 'select', { options: recipients.map(r => ({ value: r.key, label: r.name })) }),
      ...['payeeName', 'payeeTin', 'payeeAddress', 'payeeZip'].map(key => field(key, { payeeName: 'Supplier registered name', payeeTin: 'Supplier TIN and branch', payeeAddress: 'Supplier registered address', payeeZip: 'Supplier ZIP' }[key], 'text')),
      ...atcFields, field('reviewedAmounts', 'I verified supplier details, EWT ATCs and monthly income payments.', 'checkbox', { required: true, group: 'review' })],
    warnings: ['Issued certificates need the payor and payee signatures. These are outgoing supplier certificates; incoming customer certificates remain the evidence for SAWT and income-tax credits.'],
  });
  add('SAWT', 'SAWT', 'Supporting schedules', q, quarterInvoices, [], {
    description: 'Summary Alphalist of Withholding Agents · incoming customer withholding', lineCount: quarterInvoices.filter(row => amount(row.withHoldingTaxAmount) > 0).length,
    warnings: ['PDF is a review schedule, not the BIR eSubmission DAT file. Verify agents, TINs, ATCs and credits against received 2307 certificates.'],
  });
  add('QAP', 'QAP', 'Supporting schedules', q, [], quarterExpenses, {
    description: 'Quarterly Alphalist of Payees · outgoing supplier withholding', lineCount: qWithholding.length,
    warnings: ['PDF is a review schedule, not the validated QAP DAT attachment for 1601-EQ.'],
  });
  for (const [id, title, sourceInvoices, sourceExpenses] of [['SLS', 'Summary List of Sales', quarterInvoices, []], ['SLP', 'Summary List of Purchases', [], quarterExpenses]]) add(id, title, 'Supporting schedules', q, sourceInvoices, sourceExpenses, {
    reason: !vat ? 'VAT sales/purchases schedules apply to VAT-registered organizations.' : '',
    description: `VAT ${id === 'SLS' ? 'sales' : 'purchases'} review schedule · selected quarter`,
    lineCount: sourceInvoices.length + sourceExpenses.length,
    warnings: ['PDF is a transaction review schedule. RELIEF submission additionally requires classifications and its prescribed data format. Importation records are not available in this platform.'],
  });
  for (const [id, title, sourceInvoices, sourceExpenses] of [['SALES', 'Quarterly Sales Report', quarterInvoices, []], ['EXPENSES', 'Quarterly Expense Report', [], quarterExpenses]]) add(id, title, 'Transaction reports', q, sourceInvoices, sourceExpenses, {
    description: 'Detailed transaction report with quarter totals · printable PDF',
    lineCount: sourceInvoices.length + sourceExpenses.length,
  });
  add('1702RT', 'BIR 1702-RT', 'Annual returns', annual, invoices, expenses, {
    reason: 'Annual corporate returns require financial statements and annual deduction/MCIT schedules. Use the official BIR filing application to complete these schedules.',
    description: 'Annual corporate regular income tax return · full taxable year',
    officialUrl: 'https://bir-cdn.bir.gov.ph/local/pdf/1702-RT%20Jan%202018%20ENCS%20Final%20v3.pdf',
  });
  return docs;
}

function computeReportDocument(prep, input, invoices, expenses) {
  if (!prep || !prep.supported) throw new TaxReturnError(prep?.reason || 'Unknown report document.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaxReturnError('Invalid document details.');
  const v = { ...prep.defaults };
  for (const f of prep.fields) {
    const value = input[f.key] ?? v[f.key];
    if (f.type === 'amount' || f.type === 'signedAmount') {
      const pattern = f.type === 'signedAmount' ? /^-?\d{1,11}(\.\d{1,2})?$/ : /^\d{1,11}(\.\d{1,2})?$/;
      if (!pattern.test(String(value))) throw new TaxReturnError(`${f.label} must be a valid PHP amount with at most two decimal places.`);
      v[f.key] = Number(value);
    } else if (f.type === 'checkbox') {
      if (typeof value !== 'boolean') throw new TaxReturnError(`${f.label} must be Yes or No.`);
      if (f.required && !value) throw new TaxReturnError(f.label);
      v[f.key] = value;
    } else {
      v[f.key] = String(value ?? '').trim();
      if (v[f.key].length > (f.key.includes('Address') ? 500 : 200)) throw new TaxReturnError(`${f.label} is too long.`);
      if (f.type === 'select' && !f.options.some(option => option.value === v[f.key])) throw new TaxReturnError(`Select a valid ${f.label.toLowerCase()}.`);
    }
  }
  const isIncome = ['1701Q', '1702Q'].includes(prep.id);
  const isOfficial = isIncome || ['1601EQ', '2307'].includes(prep.id);
  if (isOfficial) {
    v.tin = normalizeTin(v.tin);
    if (!v.registeredName || !v.registeredAddress) throw new TaxReturnError('Registered name and address are required.');
    if (prep.id !== '2307' && !/^\d{3}$/.test(v.rdoCode)) throw new TaxReturnError('Enter the three-digit RDO code from the Certificate of Registration.');
    if ((v.previousPayment || 0) > 0 && !v.amended) throw new TaxReturnError('Previous return payments apply only to amended returns.');
  }
  const rowsIn = (rows, key) => rows.map(plain).filter(row => String(row[key]).slice(0, 10) >= prep.periodStart && String(row[key]).slice(0, 10) <= prep.periodEnd);
  let c = {};
  if (isIncome) {
    if ((v.currentWithholding > 0 || v.priorWithholding > 0) && !v.verifiedCredits) throw new TaxReturnError('Verify claimed credits against received BIR 2307 certificates.');
    if (prep.quarter === 1 && ['priorIncome', 'priorGrossIncome', 'priorPayments', 'priorWithholding', 'priorMcitPayments'].some(key => Number(v[key] || 0) !== 0)) throw new TaxReturnError('Q1 cannot include income, withholding or payments from previous quarters of the same year. Use the prior-year excess credit field where applicable.');
    if (v.otherCredits > 0 && !v.otherCreditsDescription) throw new TaxReturnError('Describe the other credits claimed.');
    if (v.otherIncome > 0 && !v.otherIncomeDescription) throw new TaxReturnError('Describe the other taxable income.');
    const r = value => Math.sign(value) * Math.round(Math.abs(value));
    const rawGross = v.sales + v.otherIncome + v.priorGrossIncome;
    const rawCorporateIncome = (v.sales - v.costSales + v.otherIncome) * (v.deductionMethod === 'osd' ? .6 : 1) - (v.deductionMethod === 'osd' ? 0 : v.deductions) + v.priorIncome;
    for (const f of prep.fields.filter(f => ['amount', 'signedAmount'].includes(f.type) && f.key !== 'totalAssets')) v[f.key] = r(v[f.key]);
    let taxDue = 0;
    if (prep.id !== '1702Q') {
      if (!['graduated', 'eight_percent'].includes(v.incomeTaxElection)) throw new TaxReturnError('Confirm the annual income tax election.');
      const fiduciary = ['estate', 'trust'].includes(v.activity);
      const born = new Date(`${v.dateOfBirth}T00:00:00Z`);
      if (!v.civilStatus || !v.citizenship || (!fiduciary && (!/^\d{4}-\d{2}-\d{2}$/.test(v.dateOfBirth) || !Number.isFinite(born.getTime()) || born.toISOString().slice(0, 10) !== v.dateOfBirth || born.getUTCFullYear() > prep.year))) throw new TaxReturnError('Complete valid citizenship, civil status/spouse scope and date of birth.');
      if (v.civilStatus === 'estate_trust' && !fiduciary) throw new TaxReturnError('Select the applicable civil status for an individual filer.');
      if (v.incomeTaxElection === 'eight_percent') {
        if (!v.eightPercentEligible || !isPercentageTaxType(prep.organizationTaxType || {}) || ['estate', 'trust'].includes(v.activity)) throw new TaxReturnError('8% requires a confirmed eligible non-VAT individual and a valid annual election.');
        const cumulativeGross = r(v.sales + v.otherIncome + v.priorGrossIncome);
        if (rawGross > 3000000 || prep.recordedCumulativeSales > 3000000) throw new TaxReturnError('The 8% option cannot be used when gross sales and other non-operating income exceed ₱3 million.');
        if (v.gppIncome > 0) throw new TaxReturnError('GPP partner income requires separate preparation under the graduated regime.');
        c = { cumulativeGross, reduction: v.mixedIncome ? 0 : 250000, currentIncome: r(v.sales + v.otherIncome) };
        c.taxableIncome = cumulativeGross - c.reduction;
        taxDue = r(Math.max(0, c.taxableIncome) * .08);
      } else {
        const osd = v.deductionMethod === 'osd';
        if (osd && v.costSales > 0) throw new TaxReturnError('Cost of sales is not separately deductible under individual OSD.');
        c.grossIncome = r(v.sales - (osd ? 0 : v.costSales));
        c.deduction = osd ? r(v.sales * .4) : v.deductions;
        c.currentIncome = c.grossIncome - c.deduction;
        c.taxableIncome = c.currentIncome + (prep.annual ? 0 : v.priorIncome) + v.otherIncome + v.gppIncome;
        taxDue = graduatedTax(c.taxableIncome, prep.year);

      }
    } else {
      if (!['20', '25'].includes(v.corporateRate)) throw new TaxReturnError('Confirm the applicable domestic corporate income tax rate.');
      if (!/^\d{4}$/.test(v.commencementYear) || Number(v.commencementYear) > prep.year || Number(v.commencementYear) < 1900) throw new TaxReturnError('Enter the valid year business operations commenced.');
      c.grossIncome = v.sales - v.costSales;
      c.totalGrossIncome = c.grossIncome + v.otherIncome;
      c.deduction = v.deductionMethod === 'osd' ? r(Math.max(0, c.totalGrossIncome) * .4) : v.deductions;
      c.currentIncome = c.totalGrossIncome - c.deduction;
      c.taxableIncome = c.currentIncome + v.priorIncome;
      if (v.corporateRate === '20' && (!v.eligibleSmallCorporation || v.totalAssets > 100000000 || rawCorporateIncome > 5000000)) throw new TaxReturnError('20% requires annual taxable income ≤ ₱5 million and qualifying total assets ≤ ₱100 million.');
      c.normalTax = r(Math.max(0, c.taxableIncome) * Number(v.corporateRate) / 100);
      c.mcitApplicable = prep.year >= Number(v.commencementYear) + 4;
      c.mcitGrossIncome = [1, 2, 3].filter(q => q <= prep.quarter).reduce((n, q) => n + v[`grossIncomeQ${q}`], 0);
      c.mcit = c.mcitApplicable ? r(c.mcitGrossIncome * .02) : 0;
      if (c.mcitApplicable && v[`grossIncomeQ${prep.quarter}`] !== Math.max(0, c.totalGrossIncome)) throw new TaxReturnError('Current-quarter MCIT gross income must match sales less cost of sales plus applicable other taxable income.');
      if (v.excessMcitCredit > 0 && (c.mcit >= c.normalTax || v.excessMcitCredit > c.normalTax)) throw new TaxReturnError('Prior-year excess MCIT can only offset verified regular income tax when the regular tax prevails.');
      taxDue = Math.max(c.normalTax, c.mcit) - v.excessMcitCredit;
    }
    c.taxDue = taxDue;
    c.credits = v.priorYearCredits + v.priorPayments + v.priorWithholding + v.currentWithholding + v.previousPayment + v.otherCredits + (v.priorMcitPayments || 0);
    c.penalties = v.surcharge + v.interest + v.compromise;
    c.stillPayable = taxDue - c.credits;
    c.totalPayable = c.stillPayable + c.penalties;
  }
  if (['1601EQ', '2307'].includes(prep.id)) {
    let rows = rowsIn(expenses, 'expenseDate').filter(row => amount(row.withHoldingTaxAmount) > 0);
    if (prep.id === '2307') {
      if (!prep.recipients.some(recipient => recipient.key === v.recipientKey)) throw new TaxReturnError('Select a certificate recipient.');
      rows = rows.filter(row => (row.vendorId || `${row.vendorTaxId || ''}:${row.vendor?.name || row.description || row.id}`) === v.recipientKey);
      v.payeeTin = normalizeTin(v.payeeTin);
      if (!v.payeeName || !v.payeeAddress) throw new TaxReturnError('Complete the supplier registered name and address.');
    }
    const grouped = new Map();
    for (const row of rows) {
      const atc = String(v[`atc_${row.withholdingTaxTypeId || 'missing'}`] || '').replace(/\s/g, '').toUpperCase();
      if (!/^W[IC]\d{3}$/.test(atc)) throw new TaxReturnError('Use the actual five-character expanded income-tax ATC (WI/WC), not a generic withholding code.');
      const rate = amount(row.withholdingTaxType?.percentage);
      if (rate <= 0 || rate > 100) throw new TaxReturnError('Configure a valid withholding rate for each recorded EWT type.');
      const base = amount(row.withholdingTaxBase ?? row.taxableAmount);
      if (base <= 0 || Math.abs(roundCurrency(base * rate / 100) - amount(row.withHoldingTaxAmount)) > .02) throw new TaxReturnError('Recorded withholding does not match its base and rate. Correct the source expense before generating.');
      const key = `${atc}:${rate}`;
      const group = grouped.get(key) || { atc, rate, description: row.withholdingTaxType?.name || atc, base: 0, tax: 0, months: [0, 0, 0] };
      group.base += base; group.tax += amount(row.withHoldingTaxAmount);
      group.months[(Number(String(row.expenseDate).slice(5, 7)) - 1) % 3] += base;
      grouped.set(key, group);
    }
    c.groups = [...grouped.values()].sort((a, b) => a.atc.localeCompare(b.atc)).map(group => ({ ...group, base: roundCurrency(group.base), tax: roundCurrency(group.tax), months: group.months.map(roundCurrency) }));
    c.taxDue = sum(c.groups, row => row.tax);
    c.base = sum(c.groups, row => row.base);
    c.months = [0, 1, 2].map(i => sum(c.groups, row => row.months[i]));
    if (prep.id === '1601EQ') {
      c.credits = roundCurrency(v.firstMonthRemittance + v.secondMonthRemittance + v.previousPayment + v.overRemittance + v.otherCredits);
      c.penalties = roundCurrency(v.surcharge + v.interest + v.compromise);
      c.stillPayable = roundCurrency(c.taxDue - c.credits); c.totalPayable = roundCurrency(c.stillPayable + c.penalties);
    }
  }
  return { ...prep, values: v, computed: c, invoices: rowsIn(invoices, 'issueDate'), expenses: rowsIn(expenses, 'expenseDate') };
}

module.exports = { prepareReportDocuments, computeReportDocument, graduatedTax, normalizeTin, period };
