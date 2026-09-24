import { strToU8, zipSync } from 'fflate';

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
  order?: {
    id: string; orderNumber?: string; status?: string; paymentStatus?: string;
    customer?: { id: string; name?: string; taxId?: string };
  };
}
export interface SalesReportRow {
  id: string; year: number; quarter: number; periodStart: string; periodEnd: string; currency: string;
  generatedAt?: string; invoiceCount?: number;
  subtotalAmount?: Money; taxAmount?: Money; discountAmount?: Money; totalAmount?: Money;
  organization?: { id: string; name?: string; legalName?: string };
}

type Cell = string | number | { value: number; style: number };
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const MONEY_FIELDS = ['amount', 'taxableAmount', 'subtotalAmount', 'taxAmount', 'withHoldingTaxAmount', 'discountAmount', 'scPwdDiscount', 'serviceCharge', 'totalAmount'] as const;
const MONEY_LABELS = ['Amount', 'Taxable amount', 'Subtotal', 'Tax', 'Withholding tax', 'Discount', 'SC/PWD discount', 'Service charge', 'Total'];
const INVOICE_HEADERS = ['Invoice #', 'Issue date', 'Due date', 'Order #', 'Customer', 'Customer TIN', 'Status', 'Payment status', 'Currency', ...MONEY_LABELS, 'Invoice ID', 'Notes'];

function xml(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
function money(value: Money | undefined): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new Error('An invoice contains an invalid amount. Review the report before exporting.');
  return Math.round(amount * 100) / 100;
}
function dateCell(value: string | undefined): Cell {
  if (!value) return '';
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return value;
  return { value: (time - Date.UTC(1899, 11, 30)) / 86400000, style: 3 };
}
function moneyCell(value: Money | undefined): Cell { return { value: money(value), style: 2 }; }
function sheet(rows: Cell[][], widths: number[], headerRow: number, filter = false): string {
  const lastColumn = columnName(widths.length - 1);
  const data = rows.map((cells, index) => `<row r="${index + 1}">${cells.map((cell, col) => {
    const ref = `${columnName(col)}${index + 1}`;
    const style = index + 1 === headerRow ? 1 : typeof cell === 'object' ? cell.style : 0;
    if (typeof cell === 'number' || typeof cell === 'object') {
      return `<c r="${ref}" s="${style}" t="n"><v>${typeof cell === 'number' ? cell : cell.value}</v></c>`;
    }
    // Inline strings preserve identifiers/TINs and never interpret user text as formulas.
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `${XML}<worksheet xmlns="${NS}"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${filter ? `<autoFilter ref="A${headerRow}:${lastColumn}${rows.length}"/>` : ''}</worksheet>`;
}

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
  const files: Record<string, string> = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Invoices" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF423C86"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': sheet(summary, [30, 42, ...MONEY_LABELS.map(() => 20)], 14),
    'xl/worksheets/sheet2.xml': sheet(invoiceRows, [24, 14, 14, 24, 34, 22, 18, 20, 12, ...MONEY_LABELS.map(() => 20), 38, 50], 1, true),
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}

export function downloadSalesReport(report: SalesReportRow, invoices: SalesInvoiceRow[]): void {
  const bytes = buildSalesReportWorkbook(report, invoices);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const organization = (report.organization?.name || report.organization?.legalName || 'organization').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60);
  link.href = url; link.download = `sales-report-${organization}-${report.year}-Q${report.quarter}-${report.id}.xlsx`;
  try { document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
