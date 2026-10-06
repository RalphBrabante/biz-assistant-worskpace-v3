import { BirParty, splitBirTin, WithholdingLine } from './bir-alphalist-export';
import { BIR_CREDITABLE_ATCS } from './bir-creditable-atcs';
import { buildWorkbook, downloadWorkbook, WorkbookSheet } from './report-workbook';
import type { SalesReportRow } from './sales-report-export';
export const BIR_ALPHALIST_VERSION = '7.4';
export const BIR_FORMAT_VERIFIED_ON = '2026-10-06';
export type AlphalistKind = 'sales' | 'expenses';
export interface ReviewedParty {
  type: string; tin: string; branch: string;
  registeredName: string; lastName: string; firstName: string; middleName: string;
}
export interface ReviewedWithholdingLine extends WithholdingLine { identity: ReviewedParty; }
export interface AlphalistDraft {
  form: string; filer: ReviewedParty; rdoCode: string; lines: ReviewedWithholdingLine[];
  reviewed: boolean; scopeConfirmed: boolean;
}
function partyDraft(party: BirParty, type = party.type || ''): ReviewedParty {
  const tin = splitBirTin(party.taxId);
  return { type, tin: tin.tin, branch: tin.branch, registeredName: party.legalName || party.name || '', lastName: '', firstName: '', middleName: '' };
}
export function createAlphalistDraft(kind: AlphalistKind, report: SalesReportRow, lines: WithholdingLine[]): AlphalistDraft {
  const org = report.organization;
  const individual = org?.taxpayerClassification === 'individual';
  const business = ['corporation', 'partnership'].includes(org?.taxpayerClassification || '');
  return {
    form: kind === 'expenses' ? '1601EQ' : report.quarter < 4 ? individual ? '1701Q' : business ? '1702Q' : '' : '',
    filer: partyDraft(org || {}, individual ? 'individual' : business ? 'business' : ''), rdoCode: org?.rdoCode || '',
    lines: lines.map(line => ({ ...line, identity: partyDraft(line.party) })), reviewed: false, scopeConfirmed: false,
  };
}
function birText(value: string, max: number, label: string, required = false): string {
  const text = value.trim().toUpperCase();
  if ((required && !text) || text.length > max || /[^\x20-\x7e]|["&',|]/.test(text)) {
    throw new Error(`${label}: enter ${required ? 'a required ' : ''}BIR-compatible value up to ${max} characters (ASCII; no quotes, apostrophes, ampersands, commas or pipes).`);
  }
  return text;
}
function identity(party: ReviewedParty, label: string): string[] {
  if (!/^\d{9}$/.test(party.tin) || ['000000000', '111111111', '999999999'].includes(party.tin)) throw new Error(`${label}: enter a valid 9-digit TIN.`);
  if (!/^\d{4}$/.test(party.branch)) throw new Error(`${label}: confirm the 4-digit branch code.`);
  if (party.type === 'business') return [party.tin, party.branch, birText(party.registeredName, 50, `${label} registered name`, true), '', '', ''];
  if (party.type === 'individual') return [party.tin, party.branch, '', birText(party.lastName, 30, `${label} last name`, true), birText(party.firstName, 30, `${label} first name`, true), birText(party.middleName, 30, `${label} middle name`)];
  throw new Error(`${label}: select individual or business taxpayer type.`);
}
function amount(value: number | string | null | undefined, label: string, positive = true): string {
  const text = String(value ?? '');
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(text) || !Number.isFinite(Number(text)) || (positive && Number(text) <= 0)) throw new Error(`${label}: enter a ${positive ? 'positive' : 'non-negative'} amount with up to 11 integer digits and 2 decimal places.`);
  return Number(text).toFixed(2);
}
export function alphalistRecords(kind: AlphalistKind, report: SalesReportRow, draft: AlphalistDraft): { records: string[][]; filename: string } {
  if (!draft.reviewed || !draft.scopeConfirmed) throw new Error('Confirm the reviewed tax details and attachment coverage before downloading.');
  if (!Number.isInteger(report.year) || report.year < 2023 || report.year > 2200 || !Number.isInteger(report.quarter) || report.quarter < 1 || report.quarter > 4) throw new Error('Alphalist 7.4 supports taxable years 2023 onward and a valid calendar quarter.');
  const form = draft.form;
  if (kind === 'expenses' ? form !== '1601EQ' : !['1701Q', '1702Q', '2551Q'].includes(form)) throw new Error('Select a supported quarterly attachment form.');
  if (kind === 'sales' && report.quarter === 4 && form !== '2551Q') throw new Error('Q4 cannot be exported as a quarterly income-tax attachment. An annual SAWT needs full-year records.');
  if (kind === 'sales' && ((form === '1701Q' && draft.filer.type !== 'individual') || (form === '1702Q' && draft.filer.type !== 'business'))) throw new Error('The income-tax form must match the filer taxpayer type.');
  const filer = identity(draft.filer, 'Filer');
  if (!/^\d{3}$/.test(draft.rdoCode)) throw new Error('Confirm the filer 3-digit RDO code.');
  if (!draft.lines.length || draft.lines.length > 99999999) throw new Error('This attachment requires at least one recorded withholding line and at most 99999999 lines.');
  const period = `${String(report.quarter * 3).padStart(2, '0')}/${report.year}`;
  const qapName = kind === 'expenses' ? birText(filer[2] || [filer[3], filer[4], filer[5]].filter(Boolean).join(' '), 50, 'QAP filer name', true) : '';
  const header = kind === 'expenses' ? ['HQAP', 'H1601EQ', filer[0], filer[1], qapName, period, draft.rdoCode]
    : ['HSAWT', `H${form}`, ...filer, period, draft.rdoCode];
  const data = draft.lines.map(line => {
    const label = line.reference;
    if (line.currency.toUpperCase() !== 'PHP') throw new Error(`${label}: BIR amounts require PHP; foreign amounts cannot be exported without verified conversion.`);
    if (['draft', 'submitted', 'cancelled', 'void'].includes(line.status || '')) throw new Error(`${label}: finalize the source transaction before exporting a filing attachment.`);
    const date = line.date || '';
    const month = (report.quarter - 1) * 3 + 1;
    const first = `${report.year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(report.year, month + 2, 0)).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || date < first || date > last || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`${label}: source date must be valid and within this reporting quarter.`);
    const party = identity(line.identity, label);
    const atc = String(line.atc || '').trim().toUpperCase();
    if (!BIR_CREDITABLE_ATCS.has(atc)) throw new Error(`${label}: select an actual creditable BIR ATC supported by Alphalist 7.4 and its current patch.`);
    // WI/WC identifies the income recipient: the payee in QAP, the filer in
    // SAWT. A corporate withholding agent may withhold from an individual.
    const recipientType = kind === 'expenses' ? line.identity.type : draft.filer.type;
    if ((atc.startsWith('WI') && recipientType !== 'individual') || (atc.startsWith('WC') && recipientType !== 'business')) throw new Error(`${label}: ATC individual/corporate classification must match the income recipient taxpayer type.`);
    const rate = amount(line.rate, `${label} tax rate`);
    if (Number(rate) >= 100) throw new Error(`${label}: tax rate must be less than 100%.`);
    const base = amount(line.incomePayment, `${label} income payment`);
    const withheld = amount(line.withheld, `${label} tax withheld`);
    if (Number(withheld) > Number(base)) throw new Error(`${label}: withholding exceeds the income payment.`);
    const nature = kind === 'sales' ? birText(line.nature || '', 50, `${label} nature of income`) : '';
    return { party, atc, rate, base, withheld, nature };
  });
  // BIR's own generator groups by identity, ATC and rate, and sorts names.
  const groups = new Map<string, { party: string[]; atc: string; rate: string; nature: string; base: number; withheld: number }>();
  data.forEach(line => {
    const key = JSON.stringify([line.party, line.atc, line.rate, line.nature]);
    const group = groups.get(key) || { ...line, base: 0, withheld: 0 };
    group.base += Math.round(Number(line.base) * 100); group.withheld += Math.round(Number(line.withheld) * 100); groups.set(key, group);
  });
  const sorted = [...groups.values()].sort((a, b) => [a.party[3], a.party[4], a.party[5], a.party[2], a.party[0], a.party[1], a.atc, a.rate].join('|').localeCompare([b.party[3], b.party[4], b.party[5], b.party[2], b.party[0], b.party[1], b.atc, b.rate].join('|')));
  const details = sorted.map((line, i) => [kind === 'expenses' ? 'D1' : 'DSAWT', kind === 'expenses' ? form : `D${form}`, String(i + 1), ...line.party, period,
    ...(kind === 'sales' ? [line.nature] : []), line.atc, line.rate, amount((line.base / 100).toFixed(2), 'Grouped income payment'), amount((line.withheld / 100).toFixed(2), 'Grouped tax withheld')]);
  const baseTotal = sorted.reduce((sum, line) => sum + line.base, 0), taxTotal = sorted.reduce((sum, line) => sum + line.withheld, 0);
  const control = [kind === 'expenses' ? 'C1' : 'CSAWT', kind === 'expenses' ? form : `C${form}`, filer[0], filer[1], period,
    amount((baseTotal / 100).toFixed(2), 'Total income payment'), amount((taxTotal / 100).toFixed(2), 'Total tax withheld')];
  return { records: [header, ...details, control], filename: `${filer[0]}${filer[1]}${String(report.quarter * 3).padStart(2, '0')}${report.year}${form}.DAT` };
}
export function buildAlphalistDat(kind: AlphalistKind, report: SalesReportRow, draft: AlphalistDraft): { bytes: Uint8Array; filename: string } {
  const { records, filename } = alphalistRecords(kind, report, draft);
  // All fields were validated against BIR's ASCII restrictions. ASCII works with
  // the Windows module without a UTF-8 BOM; FPUTS uses CRLF in the native generator.
  const data = records.map(row => row.join(',')).join('\r\n') + '\r\n';
  return { bytes: Uint8Array.from(data, char => char.charCodeAt(0)), filename };
}
export function downloadAlphalistDat(kind: AlphalistKind, report: SalesReportRow, draft: AlphalistDraft): void {
  const { bytes, filename } = buildAlphalistDat(kind, report, draft);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  try { document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function downloadReviewedAlphalistExcel(kind: AlphalistKind, report: SalesReportRow, draft: AlphalistDraft): void {
  const { records, filename } = alphalistRecords(kind, report, draft);
  const sheets: WorkbookSheet[] = [
    { name: 'BIR Records', rows: records, widths: Array.from({ length: kind === 'sales' ? 15 : 14 }, () => 28), headerRow: 0 },
    { name: 'Guide', rows: [['Target', `BIR Alphalist ${BIR_ALPHALIST_VERSION}`], ['Verified on', BIR_FORMAT_VERIFIED_ON], ['DAT filename', filename], ['Before filing', 'Run the companion DAT through the official BIR validation module with its current ATC patch. This workbook does not prove acceptance or filing.']], widths: [30, 110] },
  ];
  downloadWorkbook(buildWorkbook(sheets), filename.replace(/\.DAT$/, '.xlsx'));
}
