import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface GimoSalesExportLine {
  date: string;
  referenceNumber: string;
  customerName: string;
  customerTin: string;
  customerAddress?: string;
  grossSales: number;
  taxableSales: number;
  outputVat: number;
}

export interface GimoPurchaseExportLine {
  date: string;
  referenceNumber: string;
  vendorName: string;
  vendorTin: string;
  vendorAddress?: string;
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
  const populated = type === 'sales'
    ? populateSalesSheet(sheetXml, lines as GimoSalesExportLine[])
    : populatePurchasesSheet(sheetXml, lines as GimoPurchaseExportLine[]);
  const addresses = type === 'sales'
    ? (lines as GimoSalesExportLine[]).map(line => [line.customerName, line.customerAddress?.trim()].filter(Boolean).join('\n'))
    : (lines as GimoPurchaseExportLine[]).map(line => [line.vendorName, line.vendorAddress?.trim()].filter(Boolean).join('\n'));
  archive[sheetPath] = strToU8(wrapNameAndAddress(archive, populated, addresses,
    type === 'sales' ? SALES_DATA_START_ROW : PURCHASE_DATA_START_ROW));

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
      B: [line.vendorName, line.vendorAddress?.trim()].filter(Boolean).join('\n'),
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
      B: [line.customerName, line.customerAddress?.trim()].filter(Boolean).join('\n'),
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
  const style = match?.[1].match(/\bs="(\d+)"/)?.[1];
  const styleAttribute = style ? ` s="${style}"` : '';
  const replacement = typeof value === 'number'
    ? `<c r="${reference}"${styleAttribute}><v>${toSpreadsheetNumber(value)}</v></c>`
    : `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;

  if (!match) {
    throw new Error(`The GIMO template is missing cell ${reference}.`);
  }
  return xml.replace(cellPattern, () => replacement);
}

// Clone only the populated name/address cells' styles, retaining template
// borders and fills. Other cells and accounting formulas keep their styles.
function wrapNameAndAddress(archive: Record<string, Uint8Array>, sheetXml: string, values: string[], firstRow: number): string {
  const stylesXml = strFromU8(archive['xl/styles.xml']);
  const section = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const styles = section?.[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
  if (!section || !styles) throw new Error('The GIMO template is missing cell styles.');
  const wrapped = new Map<number, number>();
  const columnWidth = Number(sheetXml.match(/<col\b[^>]*min="2"[^>]*width="([\d.]+)"/)?.[1] || 30);
  values.forEach((value, index) => {
    const row = firstRow + index;
    const pattern = new RegExp(`(<c\\b[^>]*\\br="B${row}"[^>]*>)`);
    const cell = sheetXml.match(pattern)?.[1];
    if (!cell) throw new Error(`The GIMO template is missing cell B${row}.`);
    const style = Number(cell.match(/\bs="(\d+)"/)?.[1] || 0);
    if (!wrapped.has(style)) {
      let clone = styles[style];
      if (!clone) throw new Error('The GIMO template contains an invalid address cell style.');
      clone = clone.replace(/\sapplyAlignment="[^"]*"/, '').replace('<xf', '<xf applyAlignment="1"');
      const alignment = '<alignment wrapText="1" vertical="top"/>';
      clone = /<alignment\b/.test(clone) ? clone.replace(/<alignment\b[^>]*\/>/, alignment)
        : clone.endsWith('/>') ? clone.slice(0, -2) + `>${alignment}</xf>` : clone.replace('</xf>', `${alignment}</xf>`);
      wrapped.set(style, styles.length); styles.push(clone);
    }
    const replacement = /\bs="\d+"/.test(cell) ? cell.replace(/\bs="\d+"/, `s="${wrapped.get(style)}"`)
      : cell.replace('>', ` s="${wrapped.get(style)}">`);
    sheetXml = sheetXml.replace(pattern, replacement);
    const height = Math.min(409, 18 * value.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, columnWidth - 2))), 0));
    sheetXml = sheetXml.replace(new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)>`), (_match, attrs: string) => {
      const previous = Number(attrs.match(/\bht="([\d.]+)"/)?.[1] || 18);
      return `<row${attrs.replace(/\s(?:ht|customHeight)="[^"]*"/g, '')} ht="${Math.max(previous, height)}" customHeight="1">`;
    });
  });
  archive['xl/styles.xml'] = strToU8(stylesXml.replace(section[0], `<cellXfs count="${styles.length}">${styles.join('')}</cellXfs>`));
  return sheetXml;
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
