import { bootstrapApplication } from '@angular/platform-browser';
import { isDevMode } from '@angular/core';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

if (isDevMode() && typeof window !== 'undefined') {
  // Clean up stale service workers/caches from prior production runs on localhost.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    });
  }
  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys
        .filter((key) => key.startsWith('ngsw:'))
        .forEach((key) => {
          void caches.delete(key);
        });
    });
  }
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function syncCardTableLabels(): void {
  const tables = document.querySelectorAll<HTMLTableElement>('.table-view-wrapper table');
  tables.forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
      normalizeHeader(th.textContent || '')
    );

    if (!headers.length) {
      return;
    }

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
      cells.forEach((cell, index) => {
        const label = headers[index] || `Field ${index + 1}`;
        cell.setAttribute('data-label', label);
        if (label.toLowerCase() === 'actions') {
          cell.classList.add('card-actions-cell');
        } else {
          cell.classList.remove('card-actions-cell');
        }
      });
    });
  });
}

function installCardTableLabelSync(): void {
  let rafId = 0;
  const queueSync = () => {
    if (rafId) {
      return;
    }
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      syncCardTableLabels();
    });
  };

  queueSync();
  const observer = new MutationObserver(() => queueSync());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

bootstrapApplication(AppComponent, appConfig)
  .then(() => {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      installCardTableLabelSync();
    }
  })
  .catch((err) => console.error(err));
