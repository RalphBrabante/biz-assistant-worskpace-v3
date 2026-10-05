import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, timeout } from 'rxjs';
import { AuthService, CurrentUser } from './auth.service';
import { OrganizationContextService } from './organization-context.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly organization = inject(OrganizationContextService);
  private pending?: { token: string; request: Observable<boolean> };
  private expiryTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Check server-side revocations even while the user stays on one page.
    setInterval(() => this.recheck(), 60000);
    window.addEventListener('focus', () => this.recheck(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.recheck(true);
    });
    window.addEventListener('storage', event => {
      if ((event.key === 'accessToken' || event.key === null) &&
          localStorage.getItem('accessToken') !== this.auth.token()) {
        this.endSession();
      }
    });
  }

  validate(): Observable<boolean> {
    const token = this.auth.token();
    if (!token) {
      this.auth.clearSession();
      this.organization.clearSelectedOrganizationId();
      return of(false);
    }
    if (this.pending?.token === token) return this.pending.request;
    const request = this.http.get<{ data?: { user?: CurrentUser; expiresAt?: string } }>(
      '/api/v1/auth/session', { headers: { 'ngsw-bypass': 'true', 'Cache-Control': 'no-cache' } }
    ).pipe(
      timeout(10000),
      map(response => {
        if (this.auth.token() !== token) return false;
        const user = response.data?.user;
        const expiresAt = Date.parse(response.data?.expiresAt || '');
        if (!user?.id || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          this.endSession();
          return false;
        }
        this.auth.updateCurrentUser(user);
        this.auth.sessionVerified.set(true);
        clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(() => {
          if (this.auth.token() === token) this.endSession();
        }, Math.min(expiresAt - Date.now(), 2147483647));
        return true;
      }),
      catchError(() => {
        if (this.auth.token() === token) this.endSession();
        return of(false);
      }),
      finalize(() => { if (this.pending?.token === token) this.pending = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.pending = { token, request };
    return request;
  }

  private recheck(hideUntilValidated = false): void {
    if (!this.auth.token()) return;
    if (hideUntilValidated) this.auth.sessionVerified.set(false);
    this.validate().subscribe();
  }

  private endSession(): void {
    clearTimeout(this.expiryTimer);
    this.auth.clearSession();
    this.organization.clearSelectedOrganizationId();
    // Pricing stays public after expiry/revocation; authenticated content still redirects.
    if ((this.router.url || '').split(/[?#]/)[0] !== '/pricing') {
      void this.router.navigate(['/login'], { replaceUrl: true });
    }
  }
}
