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
  private verifiedSession?: { token: string; expiresAt: number };

  constructor() {
    // Check server-side revocations even while the user stays on one page.
    setInterval(() => this.recheck(), 60000);
    window.addEventListener('focus', () => this.recheck());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.recheck();
    });
    window.addEventListener('storage', event => {
      if ((event.key === 'accessToken' || event.key === null) &&
          localStorage.getItem('accessToken') !== this.auth.token()) {
        this.endSession();
      }
    });
  }

  validate(forceRefresh = false): Observable<boolean> {
    const token = this.auth.token();
    if (!token) {
      this.verifiedSession = undefined;
      this.auth.clearSession();
      this.organization.clearSelectedOrganizationId();
      return of(false);
    }
    // Trust only this tab's server verification, never a persisted token/user alone.
    // Page navigation stays synchronous while background checks detect revocation.
    const verified = this.verifiedSession;
    if (verified?.token === token && verified.expiresAt <= Date.now()) {
      this.endSession();
      return of(false);
    }
    if (!forceRefresh && verified?.token === token && this.auth.sessionVerified()) return of(true);
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
        this.verifiedSession = { token, expiresAt };
        this.auth.sessionVerified.set(true);
        clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(() => {
          if (this.auth.token() === token) this.endSession();
        }, Math.min(expiresAt - Date.now(), 2147483647));
        return true;
      }),
      catchError(error => {
        // A temporary background outage must not blank an otherwise valid session.
        // API 401/license failures still clear it immediately through the interceptor.
        if (this.auth.token() === token && this.verifiedSession?.token === token &&
            this.verifiedSession.expiresAt > Date.now() && this.auth.sessionVerified() &&
            error?.status !== 401 && error?.status !== 403) return of(true);
        if (this.auth.token() === token) this.endSession();
        return of(false);
      }),
      finalize(() => { if (this.pending?.token === token) this.pending = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.pending = { token, request };
    return request;
  }

  private recheck(): void {
    if (!this.auth.token()) return;
    this.validate(true).subscribe();
  }

  private endSession(): void {
    clearTimeout(this.expiryTimer);
    this.verifiedSession = undefined;
    this.auth.clearSession();
    this.organization.clearSelectedOrganizationId();
    void this.router.navigate(['/login'], { replaceUrl: true });
  }
}
