import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-home-redirect-page',
  standalone: true,
  template: '',
})
export class HomeRedirectPageComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );

    const preferredRoutes: Array<{ path: string; permissions: string[] }> =
      roleCodes.includes('inventorymanager') || roleCodes.includes('inventory_manager')
        ? [
            { path: '/items', permissions: ['items.read'] },
            { path: '/orders', permissions: ['orders.read'] },
            { path: '/dashboard', permissions: ['dashboard.read'] },
          ]
        : [
            { path: '/dashboard', permissions: ['dashboard.read'] },
            { path: '/reports', permissions: ['reports.*'] },
            { path: '/items', permissions: ['items.read'] },
            { path: '/orders', permissions: ['orders.read'] },
            { path: '/expenses', permissions: ['expenses.read'] },
            { path: '/sales-invoices', permissions: ['sales_invoices.read'] },
            { path: '/users', permissions: ['users.read'] },
          ];

    const destination =
      preferredRoutes.find((route) => this.auth.hasAnyPermission(route.permissions))?.path ||
      '/reports';
    void this.router.navigateByUrl(destination);
  }
}
