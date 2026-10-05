import type { ChatUser } from './chat.service';

export function chatInitials(user: ChatUser): string {
  const first = (user.firstName || '').trim(), last = (user.lastName || '').trim();
  const parts = first && last ? [first, last] : (first || last || user.email.split('@')[0]).split(/[\s._+\-]+/).filter(Boolean);
  return [parts[0], parts.length > 1 ? parts[parts.length - 1] : ''].filter(Boolean)
    .map(part => Array.from(part)[0]).join('').toUpperCase() || '?';
}

export function chatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function chatTimestamp(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) { const minutes = Math.floor(seconds / 60); return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`; }
  if (seconds < 86400) { const hours = Math.floor(seconds / 3600); return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`; }
  return chatDateTime(value);
}
