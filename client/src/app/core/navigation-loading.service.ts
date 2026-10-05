import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';

/** Tracks navigation and the new page's initial reads, independently of the menu. */
@Injectable({ providedIn: 'root' })
export class NavigationLoadingService {
  private readonly router = inject(Router);
  readonly navigating = signal(false);
  readonly activeUrl = signal(this.router.url);
  private readonly pendingReads = signal(0);
  readonly loading = computed(() => this.navigating() || this.pendingReads() > 0);
  private navigationId = 0;
  private captureReads = false;
  private captureTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        clearTimeout(this.captureTimer);
        this.navigationId = event.id;
        this.pendingReads.set(0);
        this.captureReads = true;
        this.activeUrl.set(event.url);
        this.navigating.set(true);
      } else if (event instanceof NavigationEnd && event.id === this.navigationId) {
        this.activeUrl.set(event.urlAfterRedirects);
        this.navigating.set(false);
        // ngOnInit may run during the render immediately after NavigationEnd.
        this.captureTimer = setTimeout(() => { this.captureReads = false; }, 0);
      } else if ((event instanceof NavigationCancel || event instanceof NavigationError ||
                  event instanceof NavigationSkipped) && event.id === this.navigationId) {
        clearTimeout(this.captureTimer);
        this.captureReads = false;
        this.pendingReads.set(0);
        this.navigating.set(false);
        this.activeUrl.set(this.router.url);
      }
    });
  }

  isActive(path: string): boolean {
    const current = this.activeUrl().split(/[?#]/)[0];
    return current === path || current.startsWith(`${path}/`);
  }

  trackRead(): () => void {
    if (!this.captureReads) return () => {};
    const id = this.navigationId;
    let completed = false;
    this.pendingReads.update(count => count + 1);
    return () => {
      if (completed) return;
      completed = true;
      if (id === this.navigationId) this.pendingReads.update(count => Math.max(0, count - 1));
    };
  }
}
