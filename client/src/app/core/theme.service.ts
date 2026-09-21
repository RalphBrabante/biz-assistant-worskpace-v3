import { Injectable, signal } from '@angular/core';

type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'themeMode';
  readonly mode = signal<ThemeMode>('light');

  init(): void {
    const stored = this.readStoredMode();
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const initialMode: ThemeMode = stored || (prefersDark ? 'dark' : 'light');
    this.setMode(initialMode);
  }

  toggle(): void {
    this.setMode(this.mode() === 'dark' ? 'light' : 'dark');
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    localStorage.setItem(this.storageKey, mode);
    document.documentElement.setAttribute('data-theme', mode);
  }

  isDark(): boolean {
    return this.mode() === 'dark';
  }

  private readStoredMode(): ThemeMode | null {
    const raw = localStorage.getItem(this.storageKey);
    if (raw === 'light' || raw === 'dark') {
      return raw;
    }
    return null;
  }
}
