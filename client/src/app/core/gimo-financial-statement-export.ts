import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface GimoSalesExportLine {
  date: string;
  referenceNumber: string;
  customerName: string;
  customerTin: string;
  grossSales: number;
  taxableSales: number;
  outputVat: number;
}

export interface GimoPurchaseExportLine {
  date: string;
  referenceNumber: string;
  vendorName: string;
  vendorTin: string;
  grossPurchases: number;
  taxablePurchases: number;
  inputVat: number;
}

type CellValue = string | number;

const PURCHASES_TEMPLATE_URL = '/templates/GIMO_FS-2026.xlsx';
const SALES_TEMPLATE_URL = '/templates/gimo-sales.xlsx';
const PURCHASES_SHEET = 'xl/worksheets/sheet1.xml';
const SALES_SHEET = 'xl/worksheets/sheet1.xml';
const PURCHASE_DATA_START_ROW = 10;
const PURCHASE_DATA_END_ROW = 263;
const SALES_DATA_START_ROW = 9;
const SALES_DATA_END_ROW = 62;

export async function downloadGimoFinancialStatement(
  type: 'sales' | 'purchases',
  lines: GimoSalesExportLine[] | GimoPurchaseExportLine[],
  year: number,
  quarter: number,
): Promise<void> {
  const templateResponse = await fetch(
    type === 'sales' ? SALES_TEMPLATE_URL : PURCHASES_TEMPLATE_URL,
    { cache: 'no-store' },
  );
  if (!templateResponse.ok) {
    throw new Error('Unable to load the GIMO financial statement template.');
  }

  const archive = unzipSync(new Uint8Array(await templateResponse.arrayBuffer()));
  const sheetPath = type === 'sales' ? SALES_SHEET : PURCHASES_SHEET;
  const capacity = type === 'sales'
    ? SALES_DATA_END_ROW - SALES_DATA_START_ROW + 1
    : PURCHASE_DATA_END_ROW - PURCHASE_DATA_START_ROW + 1;

  if (lines.length > capacity) {
    throw new Error(`The GIMO template supports up to ${capacity} ${type} lines per workbook.`);
  }

  const sheetXml = strFromU8(archive[sheetPath]);
  archive[sheetPath] = strToU8(
    type === 'sales'
      ? populateSalesSheet(sheetXml, lines as GimoSalesExportLine[])
      : populatePurchasesSheet(sheetXml, lines as GimoPurchaseExportLine[]),
  );

  const output = new Blob([zipSync(archive)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(output);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gimo-${type}-${year}-q${quarter}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function populatePurchasesSheet(xml: string, lines: GimoPurchaseExportLine[]): string {
  return lines.reduce((sheetXml, line, index) => {
    const row = PURCHASE_DATA_START_ROW + index;
    return writeCells(sheetXml, row, {
      A: line.date,
      B: line.vendorName,
      C: line.vendorTin,
      E: line.referenceNumber,
      H: line.taxablePurchases,
      J: line.inputVat,
      K: line.grossPurchases,
    });
  }, xml);
}

function populateSalesSheet(xml: string, lines: GimoSalesExportLine[]): string {
  return lines.reduce((sheetXml, line, index) => {
    const row = SALES_DATA_START_ROW + index;
    return writeCells(sheetXml, row, {
      A: line.date,
      B: line.customerName,
      C: line.customerTin,
      E: line.referenceNumber,
      H: line.grossSales,
      L: line.taxableSales,
      M: line.outputVat,
      N: line.grossSales,
    });
  }, xml);
}

function writeCells(xml: string, row: number, values: Record<string, CellValue>): string {
  return Object.entries(values).reduce(
    (sheetXml, [column, value]) => writeCell(sheetXml, `${column}${row}`, value),
    xml,
  );
}

function writeCell(xml: string, reference: string, value: CellValue): string {
  const selfClosingCellPattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)\\/>`);
  const completeCellPattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const cellPattern = selfClosingCellPattern.test(xml) ? selfClosingCellPattern : completeCellPattern;
  const match = xml.match(cellPattern);
  const style = match?.[1].match(/\\bs="(\\d+)"/)?.[1];
  const styleAttribute = style ? ` s="${style}"` : '';
  const replacement = typeof value === 'number'
    ? `<c r="${reference}"${styleAttribute}><v>${toSpreadsheetNumber(value)}</v></c>`
    : `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;

  if (!match) {
    throw new Error(`The GIMO template is missing cell ${reference}.`);
  }
  return xml.replace(cellPattern, replacement);
}

function toSpreadsheetNumber(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
