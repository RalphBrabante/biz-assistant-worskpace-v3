import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { OrganizationContextService } from './organization-context.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Public pricing is independent of login, license, and active organization.
  const pathname = req.url.split('?')[0];
  if ((req.method === 'GET' && pathname === '/api/v1/pricing/catalogue')
    || (req.method === 'POST' && pathname === '/api/v1/pricing/requests')) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);
  const organizationContext = inject(OrganizationContextService);
  const token = auth.token();
  let request = req;

  if (
    token &&
    req.method === 'GET' &&
    req.url.includes('/api/v1/') &&
    !req.url.includes('/api/v1/auth/') &&
    !req.url.includes('/api/v1/dev/') &&
    !req.url.includes('/api/v1/organizations') &&
    organizationContext.shouldApplySuperuserScope()
  ) {
    const activeOrganizationId = organizationContext.getActiveOrganizationId();
    if (activeOrganizationId && !req.url.includes('organizationId=')) {
      const separator = req.url.includes('?') ? '&' : '?';
      request = req.clone({
        url: `${req.url}${separator}organizationId=${encodeURIComponent(activeOrganizationId)}`,
      });
    }
  }

  if (
    token &&
    req.method === 'POST' &&
    req.url.includes('/api/v1/') &&
    !req.url.includes('/api/v1/auth/') &&
    !req.url.includes('/api/v1/dev/') &&
    organizationContext.isAllOrganizationsSelected() &&
    isCreateOrImportPost(req.url) &&
    !isOrganizationsEndpoint(req.url)
  ) {
    const message = 'Select a specific organization first. Imports and data creation are disabled in All Organizations mode.';
    auth.showUnauthorizedAccess(message);
    return throwError(() => ({ status: 403, error: { message } }));
  }

  if (!token || request.url.includes('/api/v1/auth/login') || request.url.includes('/api/v1/dev/')) {
    return next(request).pipe(
      catchError((err) => {
        if (err?.status === 403) {
          auth.showUnauthorizedAccess(
            err?.error?.message || 'You are not allowed to access this resource.'
          );
        }
        return throwError(() => err);
      })
    );
  }

  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    })
  ).pipe(
    catchError((err) => {
      if (auth.token() === token && request.url.includes('/api/v1/') && shouldForceLogout(err)) {
        forceLogout(auth, organizationContext, router);
        return throwError(() => err);
      }
      if (err?.status === 403) {
        auth.showUnauthorizedAccess(
          err?.error?.message || 'You are not allowed to access this resource.'
        );
      }
      return throwError(() => err);
    })
  );
};

function isCreateOrImportPost(rawUrl: string): boolean {
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, window.location.origin).pathname;
  } catch (_err) {
    pathname = rawUrl.split('?')[0] || rawUrl;
  }

  if (pathname.includes('/import')) {
    return true;
  }

  const normalized = pathname.replace(/\/+$/, '');
  return /^\/api\/v1\/[^/]+$/.test(normalized);
}

function isOrganizationsEndpoint(rawUrl: string): boolean {
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, window.location.origin).pathname;
  } catch (_err) {
    pathname = rawUrl.split('?')[0] || rawUrl;
  }
  return /^\/api\/v1\/organizations(\/|$)/.test(pathname);
}

function isLicenseInactiveError(err: any): boolean {
  if (!err || err.status !== 403) {
    return false;
  }
  const code = String(err?.error?.code || '').trim().toUpperCase();
  const message = String(err?.error?.message || '').trim().toLowerCase();
  return (
    code === 'LICENSE_INACTIVE' ||
    message.includes('license is missing') ||
    message.includes('license is revoked') ||
    message.includes('license is expired') ||
    message.includes('no active license')
  );
}

function shouldForceLogout(err: any): boolean {
  return err?.status === 401 || isLicenseInactiveError(err);
}

function forceLogout(auth: AuthService, organizationContext: OrganizationContextService, router: Router): void {
  auth.clearUnauthorizedAccess();
  auth.clearSession();
  organizationContext.clearSelectedOrganizationId();
  if (!window.location.pathname.startsWith('/login')) {
    void router.navigate(['/login'], { replaceUrl: true });
  }
}
