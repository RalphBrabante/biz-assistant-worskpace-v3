import { buildWorkbook, Cell, dateCell, money, moneyCell, downloadWorkbook } from './report-workbook';
import { buildBirPreparationSheets, salesWithholdingLines, BirParty } from './bir-alphalist-export';
import { reportAddressCell } from './report-address';

type Money = number | string | null;
export interface SalesInvoiceRow {
  id: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  amount?: Money;
  taxableAmount?: Money;
  withHoldingTaxAmount?: Money;
  subtotalAmount?: Money;
  taxAmount?: Money;
  discountAmount?: Money;
  scPwdDiscount?: Money;
  serviceCharge?: Money;
  totalAmount?: Money;
  notes?: string;
  withholdingTaxType?: { code?: string; name?: string; percentage?: Money };
  invoiceDocument?: { buyer?: { name?: string; taxId?: string; address?: string } };
  order?: {
    id: string; orderNumber?: string; status?: string; paymentStatus?: string;
    customer?: BirParty & { id: string };
  };
}
export interface SalesReportRow {
  id: string; year: number; quarter: number; periodStart: string; periodEnd: string; currency: string;
  generatedAt?: string; invoiceCount?: number;
  subtotalAmount?: Money; taxAmount?: Money; discountAmount?: Money; totalAmount?: Money;
  organization?: BirParty & { id: string; rdoCode?: string; taxpayerClassification?: string };
}

const MONEY_FIELDS = ['amount', 'taxableAmount', 'subtotalAmount', 'taxAmount', 'withHoldingTaxAmount', 'discountAmount', 'scPwdDiscount', 'serviceCharge', 'totalAmount'] as const;
const MONEY_LABELS = ['Amount', 'Taxable amount', 'Subtotal', 'Tax', 'Withholding tax', 'Discount', 'SC/PWD discount', 'Service charge', 'Total'];
const INVOICE_HEADERS = ['Invoice #', 'Issue date', 'Due date', 'Order #', 'Customer', 'Customer TIN', 'Client Address', 'Status', 'Payment status', 'Currency', ...MONEY_LABELS, 'Invoice ID', 'Notes'];

export function buildSalesReportWorkbook(report: SalesReportRow, invoices: SalesInvoiceRow[], exportedAt = new Date()): Uint8Array {
  if (invoices.length > 1048575) throw new Error('This report exceeds the Excel worksheet row limit.');
  const invoiceRows: Cell[][] = [INVOICE_HEADERS];
  const totals = new Map<string, { count: number; cents: number[] }>();
  for (const invoice of invoices) {
    const currency = invoice.currency || report.currency;
    const values = MONEY_FIELDS.map(field => money(invoice[field]));
    const group = totals.get(currency) || { count: 0, cents: MONEY_FIELDS.map(() => 0) };
    group.count++;
    values.forEach((value, i) => group.cents[i] += Math.round(value * 100));
    totals.set(currency, group);
    invoiceRows.push([
      invoice.invoiceNumber || '', dateCell(invoice.issueDate), dateCell(invoice.dueDate), invoice.order?.orderNumber || '',
      invoice.order?.customer?.name || '', invoice.order?.customer?.taxId || '',
      reportAddressCell(invoice.order?.customer, invoice.invoiceDocument?.buyer?.address),
      (invoice.status || '').replace(/_/g, ' '), (invoice.paymentStatus || '').replace(/_/g, ' '), currency,
      ...values.map(value => ({ value, style: 2 })), invoice.id, invoice.notes || '',
    ]);
  }
  const summary: Cell[][] = [
    ['Quarterly sales report'],
    ['Organization', report.organization?.name || report.organization?.legalName || ''],
    ['Reporting quarter', `${report.year} Q${report.quarter}`],
    ['Period start', dateCell(report.periodStart)], ['Period end', dateCell(report.periodEnd)],
    ['Report ID', report.id], ['Report generated at', report.generatedAt || ''],
    ['Exported at (UTC)', exportedAt.toISOString()], ['Report currency', report.currency],
    ['Saved report invoice count', report.invoiceCount ?? ''], ['Exported invoice count', invoices.length],
    ['Source', 'All non-void invoices in this report preview. Current invoice values may differ from the saved report snapshot.'],
    [], ['Currency', 'Invoice count', ...MONEY_LABELS],
    ...Array.from(totals, ([currency, group]): Cell[] => [currency, group.count, ...group.cents.map(value => ({ value: value / 100, style: 2 }))]),
    [], ['Saved report snapshot', report.currency],
    ['Subtotal', moneyCell(report.subtotalAmount)], ['Tax', moneyCell(report.taxAmount)],
    ['Discount', moneyCell(report.discountAmount)], ['Total', moneyCell(report.totalAmount)],
  ];
  return buildWorkbook([
    { name: 'Summary', rows: summary, widths: [30, 42, ...MONEY_LABELS.map(() => 20)], headerRow: 14 },
    { name: 'Invoices', rows: invoiceRows, widths: [24, 14, 14, 24, 34, 22, 70, 18, 20, 12, ...MONEY_LABELS.map(() => 20), 38, 50], filter: true },
    ...buildBirPreparationSheets('sales', report, salesWithholdingLines(invoices, report.currency)),
  ]);
}

export function downloadSalesReport(report: SalesReportRow, invoices: SalesInvoiceRow[]): void {
  const organization = (report.organization?.name || report.organization?.legalName || 'organization').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60);
  downloadWorkbook(buildSalesReportWorkbook(report, invoices), `sales-report-${organization}-${report.year}-Q${report.quarter}-${report.id}.xlsx`);
}
