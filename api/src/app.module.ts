import { Module } from '@nestjs/common';
import { LegacyApiModule } from './modules/legacy/legacy-api.module';
import { AuthModule } from './modules/auth/auth.module';
import { SystemModule } from './modules/system/system.module';
import { ItemsModule } from './modules/items/items.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { OrdersModule } from './modules/orders/orders.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { SalesInvoicesModule } from './modules/sales-invoices/sales-invoices.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TaxTypesModule } from './modules/tax-types/tax-types.module';
import { WithholdingTaxTypesModule } from './modules/withholding-tax-types/withholding-tax-types.module';
import { ProfileModule } from './modules/profile/profile.module';
import { MessagesModule } from './modules/messages/messages.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DevModule } from './modules/dev/dev.module';

@Module({
  imports: [
    LegacyApiModule,
    AuthModule,
    SystemModule,
    ItemsModule,
    OrganizationsModule,
    OrdersModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    LicensesModule,
    SalesInvoicesModule,
    CustomersModule,
    ExpensesModule,
    VendorsModule,
    ReportsModule,
    SettingsModule,
    TaxTypesModule,
    WithholdingTaxTypesModule,
    ProfileModule,
    MessagesModule,
    DashboardModule,
    DevModule,
  ],
})
export class AppModule {}
