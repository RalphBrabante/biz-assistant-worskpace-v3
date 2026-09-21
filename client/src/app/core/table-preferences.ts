export type TableViewMode = 'table' | 'card';

type TablePreferencesRecord = Record<string, unknown>;

function keyFor(storageKey: string): string {
  return `table_prefs:${String(storageKey || '').trim()}`;
}

export function loadTablePreferences(storageKey: string): TablePreferencesRecord {
  const key = keyFor(storageKey);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as TablePreferencesRecord;
  } catch (_err) {
    return {};
  }
}

export function saveTablePreferences(
  storageKey: string,
  partial: TablePreferencesRecord
): void {
  const key = keyFor(storageKey);
  const current = loadTablePreferences(storageKey);
  const next = { ...current, ...partial };
  localStorage.setItem(key, JSON.stringify(next));
}

export function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function toTableViewMode(value: unknown, fallback: TableViewMode = 'table'): TableViewMode {
  const normalized = String(value || '').toLowerCase().trim();
  return normalized === 'card' || normalized === 'table' ? (normalized as TableViewMode) : fallback;
}

