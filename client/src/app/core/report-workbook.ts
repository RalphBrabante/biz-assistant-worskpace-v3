import { strToU8, zipSync } from 'fflate';

export type Cell = string | number | { value: number; style: number };
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function xml(value: unknown): string {
  return String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
export function money(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new Error('A report contains an invalid amount. Review the report before exporting.');
  return Math.round(amount * 100) / 100;
}
export function dateCell(value: string | undefined): Cell {
  if (!value) return '';
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return value;
  return { value: (time - Date.UTC(1899, 11, 30)) / 86400000, style: 3 };
}
export function moneyCell(value: number | string | null | undefined): Cell { return { value: money(value), style: 2 }; }
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
  return `${XML}<worksheet xmlns="${NS}"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetViews><sheetView workbookViewId="0">${headerRow > 0 ? `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${filter ? `<autoFilter ref="A${headerRow}:${lastColumn}${rows.length}"/>` : ''}</worksheet>`;
}

export interface WorkbookSheet { name: string; rows: Cell[][]; widths: number[]; headerRow?: number; filter?: boolean; }

export function buildWorkbook(sheets: WorkbookSheet[]): Uint8Array {
  if (!sheets.length || sheets.some(s => !s.rows.length || s.rows.length > 1048576)) throw new Error('This report exceeds the Excel worksheet row limit.');
  const relationshipNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const officeNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: Record<string, string> = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${relationshipNS}"><Relationship Id="rId1" Type="${officeNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS}" xmlns:r="${officeNS}"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="${relationshipNS}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${officeNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${officeNS}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF423C86"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  };
  sheets.forEach((s, i) => files[`xl/worksheets/sheet${i + 1}.xml`] = sheet(s.rows, s.widths, s.headerRow ?? 1, !!s.filter));
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}

export function downloadWorkbook(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  try { document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
