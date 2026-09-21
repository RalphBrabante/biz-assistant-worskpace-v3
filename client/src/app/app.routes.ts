import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { permissionGuard } from './core/permission.guard';
import { AppShellComponent } from './layout/app-shell.component';
import { DashboardPageComponent } from './pages/dashboard-page/dashboard-page.component';
import { CreateOrderPageComponent } from './pages/create-order-page/create-order-page.component';
import { CustomersPageComponent } from './pages/customers-page/customers-page.component';
import { ExpenseDetailPageComponent } from './pages/expense-detail-page/expense-detail-page.component';
import { ExpensesPageComponent } from './pages/expenses-page/expenses-page.component';
import { ItemsPageComponent } from './pages/items-page/items-page.component';
import { LicensesPageComponent } from './pages/licenses-page/licenses-page.component';
import { LicenseEditPageComponent } from './pages/license-edit-page/license-edit-page.component';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { ResetPasswordPageComponent } from './pages/reset-password-page/reset-password-page.component';
import { OrganizationDetailPageComponent } from './pages/organization-detail-page/organization-detail-page.component';
import { OrganizationsPageComponent } from './pages/organizations-page/organizations-page.component';
import { OrdersPageComponent } from './pages/orders-page/orders-page.component';
import { OrderPreviewPageComponent } from './pages/order-preview-page/order-preview-page.component';
import { PermissionsPageComponent } from './pages/permissions-page/permissions-page.component';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';
import { ReportPreviewPageComponent } from './pages/report-preview-page/report-preview-page.component';
import { SalesReportPreviewPageComponent } from './pages/sales-report-preview-page/sales-report-preview-page.component';
import { ResourcePageComponent } from './pages/resource-page/resource-page.component';
import { RolesPageComponent } from './pages/roles-page/roles-page.component';
import { RoleDetailPageComponent } from './pages/role-detail-page/role-detail-page.component';
import { SalesInvoicesPageComponent } from './pages/sales-invoices-page/sales-invoices-page.component';
import { SalesInvoiceDetailPageComponent } from './pages/sales-invoice-detail-page/sales-invoice-detail-page.component';
import { SettingsPageComponent } from './pages/settings-page/settings-page.component';
import { UsersPageComponent } from './pages/users-page/users-page.component';
import { VendorsPageComponent } from './pages/vendors-page/vendors-page.component';
import { UserDetailPageComponent } from './pages/user-detail-page/user-detail-page.component';
import { TaxTypesPageComponent } from './pages/tax-types-page/tax-types-page.component';
import { ProfileSettingsPageComponent } from './pages/profile-settings-page/profile-settings-page.component';
import { VerifyEmailPageComponent } from './pages/verify-email-page/verify-email-page.component';
import { HomeRedirectPageComponent } from './pages/home-redirect-page/home-redirect-page.component';
import { MessagesPageComponent } from './pages/messages-page/messages-page.component';
import { PrivacyPolicyPageComponent } from './pages/privacy-policy-page/privacy-policy-page.component';
import { TermsOfServicePageComponent } from './pages/terms-of-service-page/terms-of-service-page.component';

export const routes: Routes = [
  { path: 'login', component: LoginPageComponent },
  { path: 'privacy-policy', component: PrivacyPolicyPageComponent },
  { path: 'terms-of-service', component: TermsOfServicePageComponent },
  { path: 'reset-password', component: ResetPasswordPageComponent },
  { path: 'verify-email', component: VerifyEmailPageComponent },
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardPageComponent, canActivate: [permissionGuard], data: { permissions: ['dashboard.read'] } },
      { path: 'organizations', component: OrganizationsPageComponent, canActivate: [permissionGuard], data: { permissions: ['organizations.read'] } },
      { path: 'organizations/:id', component: OrganizationDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['organizations.read'] } },
      { path: 'users', component: UsersPageComponent, canActivate: [permissionGuard], data: { permissions: ['users.read'] } },
      { path: 'users/:id', component: UserDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['users.read'] } },
      { path: 'profile', component: ProfileSettingsPageComponent },
      { path: 'roles', component: RolesPageComponent, canActivate: [permissionGuard], data: { permissions: ['roles.manage'] } },
      { path: 'roles/:id', component: RoleDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['roles.manage'] } },
      { path: 'permissions', component: PermissionsPageComponent, canActivate: [permissionGuard], data: { permissions: ['permissions.manage'] } },
      { path: 'reports', component: ReportsPageComponent, canActivate: [permissionGuard], data: { permissions: ['reports.*'] } },
      { path: 'messages', component: MessagesPageComponent, canActivate: [permissionGuard], data: { permissions: ['profile.manage'] } },
      { path: 'reports/:id', component: ReportPreviewPageComponent, canActivate: [permissionGuard], data: { permissions: ['reports.*'] } },
      { path: 'reports/sales/:id', component: SalesReportPreviewPageComponent, canActivate: [permissionGuard], data: { permissions: ['reports.*'] } },
      { path: 'settings', component: SettingsPageComponent, canActivate: [permissionGuard], data: { permissions: ['settings.update'] } },
      { path: 'items', component: ItemsPageComponent, canActivate: [permissionGuard], data: { permissions: ['items.read'] } },
      { path: 'orders', component: OrdersPageComponent, canActivate: [permissionGuard], data: { permissions: ['orders.read'] } },
      { path: 'orders/create', component: CreateOrderPageComponent, canActivate: [permissionGuard], data: { permissions: ['orders.create'] } },
      { path: 'orders/:id', component: OrderPreviewPageComponent, canActivate: [permissionGuard], data: { permissions: ['orders.read'] } },
      { path: 'customers', component: CustomersPageComponent, canActivate: [permissionGuard], data: { permissions: ['organizations.read'] } },
      { path: 'expenses/:id', component: ExpenseDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['expenses.read'] } },
      { path: 'expenses', component: ExpensesPageComponent, canActivate: [permissionGuard], data: { permissions: ['expenses.read'] } },
      { path: 'taxes', component: TaxTypesPageComponent, canActivate: [permissionGuard], data: { permissions: ['expenses.read'] } },
      { path: 'tax-types', pathMatch: 'full', redirectTo: 'taxes' },
      { path: 'vendors', component: VendorsPageComponent, canActivate: [permissionGuard], data: { permissions: ['vendors.read'] } },
      { path: 'licenses', component: LicensesPageComponent, canActivate: [permissionGuard], data: { permissions: ['licenses.read'] } },
      { path: 'license/:id', component: LicenseEditPageComponent, canActivate: [permissionGuard], data: { permissions: ['licenses.read'] } },
      { path: 'sales-invoices', component: SalesInvoicesPageComponent, canActivate: [permissionGuard], data: { permissions: ['sales_invoices.read'] } },
      { path: 'sales-invoices/:id', component: SalesInvoiceDetailPageComponent, canActivate: [permissionGuard], data: { permissions: ['sales_invoices.read'] } },
      { path: '', pathMatch: 'full', component: HomeRedirectPageComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
