import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const required = (route.data?.['permissions'] as string[] | undefined) || [];
  if (auth.hasAnyPermission(required)) {
    return true;
  }

  const message = required.length > 0
    ? `Missing required permission: ${required.join(' OR ')}`
    : 'You are not allowed to access this section.';
  auth.showUnauthorizedAccess(message);
  const fallbackRoutes: Array<{ path: string; permissions: string[] }> = [
    { path: '/dashboard', permissions: ['dashboard.read'] },
    { path: '/reports', permissions: ['reports.*'] },
    { path: '/items', permissions: ['items.read'] },
    { path: '/orders', permissions: ['orders.read'] },
    { path: '/expenses', permissions: ['expenses.read'] },
    { path: '/sales-invoices', permissions: ['sales_invoices.read'] },
    { path: '/users', permissions: ['users.read'] },
    { path: '/organizations', permissions: ['organizations.read'] },
  ];
  const destination =
    fallbackRoutes.find((candidate) => auth.hasAnyPermission(candidate.permissions))?.path ||
    '/login';
  return router.parseUrl(destination);
};
