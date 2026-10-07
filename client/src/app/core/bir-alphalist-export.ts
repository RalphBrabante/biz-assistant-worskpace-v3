import { Cell, money, moneyCell, WorkbookSheet } from './report-workbook';
import type { SalesInvoiceRow, SalesReportRow } from './sales-report-export';
import type { ExpenseRow } from './expense-report-export';
import type { ReportAddress } from './report-address';

export interface BirParty extends ReportAddress {
  name?: string; legalName?: string; taxId?: string; type?: string;
}
export interface WithholdingLine {
  reference: string; date?: string; currency: string; status?: string;
  party: BirParty; atc?: string; nature?: string; rate?: number | string | null;
  incomePayment: number; withheld: number;
}
// The Alphalist v7.4 layouts separate the 9-digit TIN from a 4-digit branch.
// Normalize separators only. Never discard invalid characters or invent a branch.
export function splitBirTin(value?: string): { tin: string; branch: string; valid: boolean } {
  const digits = String(value ?? '').trim().replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return { tin: digits, branch: '', valid: false };
  if (digits.length === 9) return { tin: digits, branch: '', valid: true };
  const suffix = digits.slice(9);
  if (![12, 13, 14].includes(digits.length) || (suffix.length === 5 && suffix[0] !== '0')) return { tin: digits, branch: '', valid: false };
  return { tin: digits.slice(0, 9), branch: suffix.padStart(4, '0').slice(-4), valid: true };
}
export function salesWithholdingLines(invoices: SalesInvoiceRow[], currency: string): WithholdingLine[] {
  return invoices.map(row => {
    const customer = row.order?.customer || {};
    const buyer = row.invoiceDocument?.buyer;
    return {
      reference: row.invoiceNumber || row.id, date: row.issueDate, currency: row.currency || currency, status: row.status,
      party: buyer ? { ...customer, name: buyer.name, legalName: buyer.name, taxId: buyer.taxId } : customer,
      atc: row.withholdingTaxType?.code, nature: row.withholdingTaxType?.name, rate: row.withholdingTaxType?.percentage,
      incomePayment: money(row.taxableAmount ?? row.subtotalAmount), withheld: money(row.withHoldingTaxAmount),
    };
  }).filter(line => line.withheld !== 0);
}
export function expenseWithholdingLines(expenses: ExpenseRow[], currency: string): WithholdingLine[] {
  return expenses.map(row => ({
    reference: row.expenseNumber || row.id, date: row.expenseDate, currency: row.currency || currency, status: row.status,
    party: { ...row.vendor, taxId: row.vendorTaxId || row.vendor?.taxId },
    atc: row.withholdingTaxType?.code, nature: row.withholdingTaxType?.name, rate: row.withholdingTaxType?.percentage,
    incomePayment: money(row.withholdingTaxBase ?? (money(row.amount) - money(row.receiptVatAmount ?? row.taxAmount))),
    withheld: money(row.withHoldingTaxAmount),
  })).filter(line => line.withheld !== 0);
}
const QAP_HEADERS = ['SCHEDULE_NUM', 'FTYPE_CODE', 'SEQ_NUM', 'TIN_PAYEE', 'BRANCH_CODE_PAYEE', 'REGISTERED_NAME_PAYEE', 'LAST_NAME_PAYEE', 'FIRST_NAME_PAYEE', 'MIDDLE_NAME_PAYEE', 'RETRN_PERIOD', 'ATC_CODE', 'TAX_RATE', 'INCOME_PAYMENT', 'ACTUAL_AMT_WTHLD'];
const SAWT_HEADERS = ['ALPHA_TYPE', 'FTYPE_CODE', 'SEQUENCE_NUM', 'EMPLOYER_TIN', 'EMPLOYER_BRANCH_CODE', 'REGISTERED_NAME', 'LAST_NAME', 'FIRST_NAME', 'MIDDLE_NAME', 'RETRN_PERIOD', 'NATURE_INCOME', 'ATC_CODE', 'TAX_RATE', 'INCOME_PAYMENT', 'ACTUAL_AMT_WTHLD'];

export function buildBirPreparationSheets(kind: 'sales' | 'expenses', report: SalesReportRow, lines: WithholdingLine[]): WorkbookSheet[] {
  const qap = kind === 'expenses';
  const org: Partial<NonNullable<SalesReportRow['organization']>> = report.organization || {};
  const tin = splitBirTin(org.taxId);
  const period = `${String(report.quarter * 3).padStart(2, '0')}/${report.year}`;
  const classification = org.taxpayerClassification;
  // Never select an annual return from a single Q4 preview.
  const form = qap ? '1601EQ' : report.quarter < 4 ? classification === 'individual' ? '1701Q' : ['corporation', 'partnership'].includes(classification || '') ? '1702Q' : '' : '';
  const issues: Cell[][] = [['Reference', 'Field', 'Review needed']];
  const flag = (ref: string, field: string, message: string) => issues.push([ref, field, message]);
  if (!tin.valid) flag('Organization', 'TIN', 'Enter a valid 9-digit TIN and separate 4-digit branch code.');
  if (!tin.branch) flag('Organization', 'Branch code', 'Confirm the 4-digit branch code; no branch has been assumed.');
  if (!org.rdoCode || !/^\d{3}$/.test(org.rdoCode)) flag('Organization', 'RDO', 'Confirm the 3-digit RDO code.');
  if (!form) flag('Organization', 'Form type', 'Select the applicable SAWT return. Q4 alone is not a complete annual attachment.');
  flag('Organization', 'Registered name / individual names', 'Confirm the registered name or enter separate last, first and middle names for an individual filer.');
  const rows: Cell[][] = [qap ? QAP_HEADERS : SAWT_HEADERS];
  lines.forEach((line, i) => {
    const partyTin = splitBirTin(line.party.taxId);
    const knownBusiness = line.party.type === 'business';
    // Display names cannot reliably be split into legally registered individual names.
    const name = line.party.type !== 'individual' ? line.party.legalName || line.party.name || '' : '';
    if (!partyTin.valid) flag(line.reference, 'TIN', 'Missing or invalid TIN.');
    if (!partyTin.branch) flag(line.reference, 'Branch code', 'Confirm the separate 4-digit branch code.');
    if (!knownBusiness) flag(line.reference, 'Registered name / individual names', `Confirm taxpayer type and registered name or separate individual names for ${line.party.legalName || line.party.name || 'unclassified counterparty'}.`);
    if (!name && knownBusiness) flag(line.reference, 'Registered name', 'Missing registered business name.');
    if (name.length > 50) flag(line.reference, 'Registered name', 'BIR permits 50 characters; review the name. It has not been truncated.');
    if (!/^W[IC]\d{3}$/.test(line.atc || '')) flag(line.reference, 'ATC', 'Confirm an actual BIR creditable-withholding ATC (for example WC158), not an internal tax code.');
    if (line.rate === undefined || line.rate === null || line.rate === '' || Number(line.rate) <= 0 || Number(line.rate) >= 100) flag(line.reference, 'Tax rate', 'Confirm the applicable withholding rate.');
    if (!qap && !line.nature) flag(line.reference, 'Nature of income', 'Enter the nature of income payment.');
    if (line.currency.toUpperCase() !== 'PHP') flag(line.reference, 'Currency', 'BIR amounts must be PHP. Confirm conversion; foreign amounts have not been converted.');
    if (['draft', 'submitted'].includes(line.status || '')) flag(line.reference, 'Status', 'Review this unposted transaction before including it in a filing.');
    if (line.incomePayment < 0 || line.withheld < 0) flag(line.reference, 'Amounts', 'Negative amounts require accountant review.');
    const rate: Cell = line.rate === undefined || line.rate === null || line.rate === '' ? '' : moneyCell(line.rate);
    const common: Cell[] = [i + 1, partyTin.tin, partyTin.branch, name, '', '', '', period];
    rows.push(qap ? ['D1', form, ...common, line.atc || '', rate, moneyCell(line.incomePayment), moneyCell(line.withheld)]
      : ['DSAWT', form ? `D${form}` : '', ...common, line.nature || '', line.atc || '', rate, moneyCell(line.incomePayment), moneyCell(line.withheld)]);
  });
  const noteRows: Cell[][] = [
    ['BIR alphalist preparation', qap ? 'QAP — 1601EQ Schedule 1' : 'SAWT — withholding agents for sales income'],
    ['Reporting period', period], ['Filer TIN', tin.tin], ['Filer branch', tin.branch],
    ['Filer registered/display name', org.legalName || org.name || ''], ['Filer RDO', org.rdoCode || ''],
    ['Candidate return form', form], ['Withholding lines', lines.length],
    ['Income payment total (PHP rows only)', moneyCell(lines.filter(l => l.currency.toUpperCase() === 'PHP').reduce((sum, l) => sum + Math.round(l.incomePayment * 100), 0) / 100)],
    ['Tax withheld total (PHP rows only)', moneyCell(lines.filter(l => l.currency.toUpperCase() === 'PHP').reduce((sum, l) => sum + Math.round(l.withheld * 100), 0) / 100)],
    ['Before import', 'Resolve BIR Review items and confirm the target return, ATCs, rates and Form 2307 support with your accountant.'],
    ['File format', 'Detail worksheet follows prescribed BIR field order. Use BIR Alphalist Export on the report preview to review identities and download complete DAT records or reviewed Excel. Validate the DAT in the latest BIR module and ATC patch; do not rename XLSX to DAT.'],
    ['Coverage', 'Only transactions with recorded withholding appear in the detail sheet. All transactions remain on the main sheet. No exempt QAP Schedule 2 or final-withholding QAP is inferred.'],
    ['VAT reports', 'RELIEF/SLSP is a separate sales/purchases/importations format. This withholding worksheet is not a RELIEF import. Importation/customs data is not stored in these reports.'],
    ['QAP source', 'https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2025-2024%20Annex%20A.pdf'],
    ['SAWT source', 'https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2015-2025%20Annex%20A.pdf'],
  ];
  if (issues.length === 1) issues.push(['', '', 'Confirm source amounts and complete required filer information before conversion.']);
  return [
    { name: 'BIR Guide', rows: noteRows, widths: [45, 115] },
    { name: qap ? 'QAP Details' : 'SAWT Details', rows, widths: rows[0].map((_, i) => i === 5 ? 52 : 24), filter: true },
    { name: 'BIR Review', rows: issues, widths: [30, 40, 115], filter: true },
  ];
}
