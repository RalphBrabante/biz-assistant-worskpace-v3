import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { PRICING_CATALOGUE } from '../../../../api/src/modules/pricing/pricing-domain';

export interface LicenseOrganization {
  id: string;
  name?: string;
  legalName?: string;
}

export interface LicenseRow {
  id: string;
  organizationId?: string | null;
  organization?: LicenseOrganization | null;
  key: string;
  planName?: string;
  status?: string;
  startsAt?: string;
  expiresAt?: string;
  revokedAt?: string | null;
  maxUsers?: number | null;
  seatsUsed?: number | null;
  isActive?: boolean;
  notes?: string;
  expiryNoticeStage?: number | null;
}

export interface LicenseSummary {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  revoked: number;
  suspended: number;
}

/** Mirrors api/src/services/license-service.js. */
export const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const LICENSE_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

/** List filter values. "expiring" is a view over active licenses, not a stored status. */
export const LICENSE_STATUS_FILTER_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring Soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'revoked', label: 'Revoked' },
];

export const LICENSE_PLANS = PRICING_CATALOGUE.plans.map((plan) => ({
  name: plan.name,
  descriptor: plan.descriptor,
  includedUsers: plan.includedUsers,
}));

export const EXTENSION_PRESETS = [
  { id: '1m', label: '1 month', months: 1 },
  { id: '3m', label: '3 months', months: 3 },
  { id: '6m', label: '6 months', months: 6 },
  { id: '1y', label: '1 year', months: 12 },
  { id: '2y', label: '2 years', months: 24 },
];

export function statusFilterLabel(value: string): string {
  return LICENSE_STATUS_FILTER_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function licenseStatusLabel(value: string | undefined | null): string {
  const status = String(value || '').toLowerCase();
  return LICENSE_STATUS_OPTIONS.find((option) => option.value === status)?.label || (status ? status[0].toUpperCase() + status.slice(1) : 'Unknown');
}

export function planOptions(current?: string | null): { name: string; label: string; includedUsers: number | null }[] {
  const options: { name: string; label: string; includedUsers: number | null }[] = LICENSE_PLANS.map((plan) => ({ name: plan.name, label: `${plan.name} — ${plan.descriptor}`, includedUsers: plan.includedUsers }));
  const existing = String(current || '').trim();
  // Licenses created before plans came from the catalogue keep their own plan name.
  if (existing && !options.some((option) => option.name === existing)) {
    options.push({ name: existing, label: `${existing} (custom)`, includedUsers: null });
  }
  return options;
}

export function daysUntil(value: string | Date | undefined | null, now = new Date()): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - now.getTime()) / DAY_MS);
}

export type LicenseTone = 'success' | 'warning' | 'danger' | 'secondary';

export interface LicenseState {
  label: string;
  tone: LicenseTone;
  icon: string;
  /** Whether this license currently lets its organization sign in. */
  grantsAccess: boolean;
  detail: string;
}

/** What a license means for its organization right now, using the same rule as the API. */
export function licenseState(row: LicenseRow | null | undefined, now = new Date()): LicenseState {
  const status = String(row?.status || '').toLowerCase();
  const days = daysUntil(row?.expiresAt, now);
  if (!row) return { label: 'Unknown', tone: 'secondary', icon: 'bi-question-circle', grantsAccess: false, detail: '' };
  if (status === 'revoked' || row.revokedAt) {
    return { label: 'Revoked', tone: 'danger', icon: 'bi-slash-circle', grantsAccess: false, detail: 'Revoked licenses never grant access until reinstated.' };
  }
  if (status === 'suspended') {
    return { label: 'Suspended', tone: 'secondary', icon: 'bi-pause-circle', grantsAccess: false, detail: 'Members cannot sign in while the license is suspended.' };
  }
  const lapsed = Boolean(row.expiresAt) && new Date(row.expiresAt as string).getTime() < now.getTime();
  if (status === 'expired' || lapsed) {
    return { label: 'Expired', tone: 'danger', icon: 'bi-x-circle', grantsAccess: false, detail: expiryPhrase(days) };
  }
  if (row.isActive === false) {
    return { label: 'Disabled', tone: 'secondary', icon: 'bi-toggle-off', grantsAccess: false, detail: 'Turned off. Enable it to grant access.' };
  }
  if (days !== null && days <= EXPIRING_SOON_DAYS) {
    return { label: 'Expiring Soon', tone: 'warning', icon: 'bi-hourglass-split', grantsAccess: true, detail: expiryPhrase(days) };
  }
  return { label: 'Active', tone: 'success', icon: 'bi-check-circle', grantsAccess: true, detail: expiryPhrase(days) };
}

export function expiryPhrase(days: number | null): string {
  if (days === null) return '';
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return 'Expires within a day';
  if (days === 0) return 'Expired today';
  return `Expired ${Math.abs(days)} day${days === -1 ? '' : 's'} ago`;
}

export function badgeClass(tone: LicenseTone): string {
  return `ui-badge ui-badge-${tone}`;
}

export function seatLimit(row: LicenseRow | null | undefined): number | null {
  const maxUsers = Number(row?.maxUsers || 0);
  return Number.isInteger(maxUsers) && maxUsers > 0 ? maxUsers : null;
}

export function seatSummary(row: LicenseRow | null | undefined): { label: string; full: boolean; over: boolean } {
  const limit = seatLimit(row);
  const used = row?.seatsUsed;
  if (used === null || used === undefined) return { label: limit ? `Up to ${limit}` : 'Unlimited', full: false, over: false };
  if (!limit) return { label: `${used} / Unlimited`, full: false, over: false };
  return { label: `${used} / ${limit}`, full: used >= limit, over: used > limit };
}

export function organizationLabel(row: LicenseRow): string {
  return row.organization?.name || row.organization?.legalName || (row.organizationId ? row.organizationId : 'Unassigned');
}

/** Mirrors extendedExpiry in the API: add to the current term, or from now once it has lapsed. */
export function previewExtension(expiresAt: string | undefined | null, months: number, now = new Date()): Date {
  const current = expiresAt ? new Date(expiresAt) : null;
  const base = current && !Number.isNaN(current.getTime()) && current.getTime() > now.getTime() ? current : now;
  const next = new Date(base);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export function toDateTimeLocal(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function addMonthsLocal(value: string, months: number): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return toDateTimeLocal(previewExtension(null, months, date));
}

function licenseDateRangeValidator(control: AbstractControl): ValidationErrors | null {
  const startsAt = String(control.get('startsAt')?.value || '').trim();
  const expiresAt = String(control.get('expiresAt')?.value || '').trim();
  if (!startsAt || !expiresAt) return null;
  return new Date(expiresAt).getTime() <= new Date(startsAt).getTime() ? { invalidDateRange: true } : null;
}

function wholeNumberOrBlank(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100000 ? null : { seats: true };
}

export interface LicenseFormDefaults {
  organizationId?: string;
  key?: string;
  planName?: string;
  status?: string;
  startsAt?: string;
  expiresAt?: string;
  maxUsers?: number | null;
  isActive?: boolean;
  notes?: string;
}

export function createLicenseForm(fb: FormBuilder, defaults: LicenseFormDefaults = {}): FormGroup {
  return fb.group(
    {
      organizationId: [defaults.organizationId ?? ''],
      key: [defaults.key ?? ''],
      planName: [defaults.planName ?? '', [Validators.required, Validators.maxLength(100)]],
      status: [defaults.status ?? 'active', [Validators.required]],
      startsAt: [defaults.startsAt ?? '', [Validators.required]],
      expiresAt: [defaults.expiresAt ?? '', [Validators.required]],
      maxUsers: [defaults.maxUsers ?? null, [wholeNumberOrBlank]],
      isActive: [defaults.isActive ?? true],
      notes: [defaults.notes ?? '', [Validators.maxLength(1000)]],
    },
    { validators: [licenseDateRangeValidator] }
  );
}

export function licenseFieldError(form: FormGroup, name: string): string {
  const control = form.get(name);
  if (name === 'expiresAt' && form.errors?.['invalidDateRange'] && (control?.touched || form.get('startsAt')?.touched)) {
    return 'The expiry date must be after the start date.';
  }
  if (!control || !control.touched || !control.errors) return '';
  if (control.errors['required']) {
    return ({ planName: 'Choose a plan.', startsAt: 'Enter a start date.', expiresAt: 'Enter an expiry date.', status: 'Choose a status.' } as Record<string, string>)[name] || 'This field is required.';
  }
  if (control.errors['seats']) return 'Enter a whole number from 1 to 100,000, or leave blank for unlimited.';
  if (control.errors['maxlength']) return `Keep this under ${control.errors['maxlength'].requiredLength} characters.`;
  return 'Check this value.';
}

/** Converts form values into the API payload. The key is sent only on create. */
export function licensePayload(form: Record<string, unknown>, includeKey: boolean): Record<string, unknown> {
  const text = (value: unknown) => String(value ?? '').trim();
  const date = (value: unknown) => (text(value) ? new Date(text(value)).toISOString() : undefined);
  const maxUsers = text(form['maxUsers']);
  const payload: Record<string, unknown> = {
    organizationId: text(form['organizationId']) || null,
    planName: text(form['planName']),
    status: text(form['status']) || 'active',
    startsAt: date(form['startsAt']),
    expiresAt: date(form['expiresAt']),
    maxUsers: maxUsers ? Number(maxUsers) : null,
    isActive: Boolean(form['isActive']),
    notes: text(form['notes']),
  };
  if (includeKey) payload['key'] = text(form['key']);
  return payload;
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
