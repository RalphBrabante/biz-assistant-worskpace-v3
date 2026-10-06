import { buildWorkbook, Cell, dateCell, money, moneyCell, downloadWorkbook } from './report-workbook';
import { BirParty, buildBirPreparationSheets, expenseWithholdingLines } from './bir-alphalist-export';
import type { SalesReportRow } from './sales-report-export';
type Money = number | string | null;
export interface ExpenseRow {
  id: string; expenseNumber?: string; expenseDate: string; dueDate?: string;
  category?: string; description?: string; status?: string; currency?: string; vendorTaxId?: string;
  amount?: Money; taxableAmount?: Money; taxAmount?: Money; vatExemptAmount?: Money;
  receiptVatAmount?: Money; withholdingTaxBase?: Money; withHoldingTaxAmount?: Money;
  discountAmount?: Money; scPwdDiscount?: Money; serviceCharge?: Money; totalAmount?: Money;
  vendor?: BirParty & { id: string };
  taxType?: { id: string; code?: string; name?: string; percentage?: Money };
  withholdingTaxType?: { id: string; code?: string; name?: string; percentage?: Money };
}
export interface ExpenseReportRow extends SalesReportRow { expenseCount?: number; amount?: Money; }
const FIELDS = ['amount', 'taxableAmount', 'taxAmount', 'vatExemptAmount', 'receiptVatAmount', 'withholdingTaxBase', 'withHoldingTaxAmount', 'discountAmount', 'scPwdDiscount', 'serviceCharge', 'totalAmount'] as const;
const LABELS = ['Receipt total', 'Taxable purchases', 'Input VAT', 'VAT-exempt amount', 'Supplier receipt VAT', 'Withholding base', 'Withholding tax', 'Discount', 'SC/PWD discount', 'Service charge', 'Net payable'];
export function buildExpenseReportWorkbook(report: ExpenseReportRow, expenses: ExpenseRow[], exportedAt = new Date()): Uint8Array {
  if (expenses.length > 1048575) throw new Error('This report exceeds the Excel worksheet row limit.');
  const rows: Cell[][] = [['Expense #', 'Expense date', 'Due date', 'Vendor', 'Vendor TIN', 'Category', 'Status', 'Currency', 'Tax type', 'ATC', 'Withholding rate', ...LABELS, 'Expense ID', 'Description']];
  const totals = new Map<string, { count: number; cents: number[] }>();
  expenses.forEach(row => {
    const currency = row.currency || report.currency;
    const values = FIELDS.map(key => row[key] === undefined || row[key] === null ? undefined : money(row[key]));
    const group = totals.get(currency) || { count: 0, cents: FIELDS.map(() => 0) };
    group.count++; values.forEach((v, i) => group.cents[i] += Math.round((v ?? 0) * 100)); totals.set(currency, group);
    rows.push([row.expenseNumber || '', dateCell(row.expenseDate), dateCell(row.dueDate), row.vendor?.legalName || row.vendor?.name || '',
      row.vendorTaxId || row.vendor?.taxId || '', row.category || '', row.status || '', currency, row.taxType?.code || row.taxType?.name || '',
      row.withholdingTaxType?.code || '', row.withholdingTaxType?.percentage == null ? '' : moneyCell(row.withholdingTaxType.percentage),
      ...values.map((value): Cell => value === undefined ? '' : moneyCell(value)), row.id, row.description || '']);
  });
  const summary: Cell[][] = [
    ['Quarterly expense report'], ['Organization', report.organization?.legalName || report.organization?.name || ''],
    ['Reporting quarter', `${report.year} Q${report.quarter}`], ['Period start', dateCell(report.periodStart)], ['Period end', dateCell(report.periodEnd)],
    ['Report ID', report.id], ['Report generated at', report.generatedAt || ''], ['Exported at (UTC)', exportedAt.toISOString()], ['Report currency', report.currency],
    ['Saved report expense count', report.expenseCount ?? ''], ['Exported expense count', expenses.length],
    ['Source', 'All non-cancelled expenses in this preview. Current expense values may differ from the saved report snapshot.'],
    ['Optional values', 'Blank receipt VAT or withholding base means not recorded. Currency totals sum recorded values only.'],
    ['Currency', 'Expense count', ...LABELS],
    ...Array.from(totals, ([currency, group]): Cell[] => [currency, group.count, ...group.cents.map(c => moneyCell(c / 100))]),
    [], ['Saved report snapshot', report.currency], ['Amount', moneyCell(report.amount)], ['Tax', moneyCell(report.taxAmount)],
    ['Discount', moneyCell(report.discountAmount)], ['Total', moneyCell(report.totalAmount)],
  ];
  return buildWorkbook([
    { name: 'Summary', rows: summary, widths: [32, 44, ...LABELS.map(() => 24)], headerRow: 14 },
    { name: 'Expenses', rows, widths: [24, 14, 14, 40, 24, 22, 18, 12, 24, 16, 22, ...LABELS.map(() => 24), 38, 55], filter: true },
    ...buildBirPreparationSheets('expenses', report, expenseWithholdingLines(expenses, report.currency)),
  ]);
}
export function downloadExpenseReport(report: ExpenseReportRow, expenses: ExpenseRow[]): void {
  const organization = (report.organization?.name || report.organization?.legalName || 'organization').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60);
  downloadWorkbook(buildExpenseReportWorkbook(report, expenses), `expense-report-${organization}-${report.year}-Q${report.quarter}-${report.id}.xlsx`);
}
