import type { Cell } from './report-workbook';

export interface ReportAddress {
  addressLine1?: string; addressLine2?: string; barangay?: string; city?: string;
  state?: string; province?: string; postalCode?: string; country?: string;
}

export function formatReportAddress(party?: ReportAddress): string {
  return [party?.addressLine1, party?.addressLine2, party?.barangay, party?.city,
    party?.state, party?.province, party?.postalCode, party?.country]
    .map(value => String(value ?? '').trim()).filter(Boolean).join(', ');
}

export function reportAddressCell(party?: ReportAddress, savedAddress?: string): Cell {
  return { value: savedAddress?.trim() || formatReportAddress(party), style: 4 };
}
