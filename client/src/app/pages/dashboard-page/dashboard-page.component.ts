import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ElementRef,
  inject,
  NgZone,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { catchError, forkJoin, map, of, Subscription } from 'rxjs';
import { Chart, registerables, TooltipItem } from 'chart.js';

Chart.register(...registerables);

interface DashboardMetrics {
  totalItems: number | null;
  totalCustomers: number | null;
  totalOrders: number | null;
  totalUsers: number | null;
  totalOrganizations: number | null;
  totalLicenses: number | null;
  totalSalesInvoices: number | null;
}

interface RecentRecord {
  id: string;
  invoiceNumber?: string;
  expenseNumber?: string;
  createdAt?: string;
  issueDate?: string;
  expenseDate?: string;
  status?: string;
  totalAmount?: number;
  currency?: string;
  vendor?: { name?: string };
  order?: { customer?: { name?: string } };
  organization?: { name?: string };
}
interface ActivityRow {
  id: string;
  label: string;
  party: string;
  kind: 'Invoice' | 'Expense';
  route: string;
  date?: string;
  createdAt?: string;
  status: string;
  amount: number;
  currency: string;
}

interface MonthlyDataPoint {
  month: number;
  monthName: string;
  sales: number;
  expenses: number;
}

interface MonthlySummaryResponse {
  year: number;
  currency: string;
  totalSales: number;
  totalExpenses: number;
  months: MonthlyDataPoint[];
}

type ActionKind = 'invoices' | 'expenses';
interface ActionRecord {
  id: string;
  reference: string;
  party: string;
  date: string;
  daysOverdue: number | null;
  totalAmount: number;
  currency: string;
  partiallyPaid: boolean;
}
interface ActionPage {
  rows: ActionRecord[];
  total: number;
  page: number;
  pageSize: number;
}
interface ActionQueue {
  kind: ActionKind;
  title: string;
  description: string;
  route: string;
  loading: boolean;
  error: string;
  data: ActionPage | null;
  subscription?: Subscription;
}

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);
  private readonly auth = inject(AuthService);
  private readonly organizationContext = inject(OrganizationContextService);

  @ViewChild('salesExpenseChart') salesExpenseChartRef?: ElementRef<HTMLCanvasElement>;
  private salesExpenseChart: Chart<'bar', number[], string> | null = null;

  private overviewSubscription?: Subscription;
  private chartSubscription?: Subscription;
  private monthlySummary: MonthlySummaryResponse | null = null;
  lastUpdated: Date | null = null;
  recentActivity: ActivityRow[] = [];
  activityError = '';
  readonly actionQueues: ActionQueue[] = [
    { kind: 'invoices', title: 'Collect overdue invoices', description: 'Unpaid invoices past their due date, oldest first.', route: '/sales-invoices', loading: false, error: '', data: null },
    { kind: 'expenses', title: 'Review pending expenses', description: 'Submitted expenses awaiting approval, oldest expense date first.', route: '/expenses', loading: false, error: '', data: null },
  ];
  workQueue: Array<{ label: string; count: number | null; route: string; status: string; icon: string; description: string }> = [];
  chartCurrency = '';
  loading = false;
  error = '';
  health: Record<string, unknown> | null = null;
  metrics: DashboardMetrics | null = null;
  orderStatusCounts: Array<{ label: string; value: number | null; className: string }> = [];
  orderStatusMax = 1;
  selectedYear = new Date().getFullYear();
  chartLoading = false;
  chartError = '';
  chartView: 'monthly' | 'quarterly' = 'monthly';
  yearlySalesTotal = 0;
  yearlyExpenseTotal = 0;
  readonly availableYears = Array.from({ length: 8 }, (_v, index) => new Date().getFullYear() - index);

  trackByMetric(_index: number, row: { label: string }): string { return row.label; }

  get metricCards(): Array<{ label: string; value: number | null; icon: string; route: string }> {
    const m = this.metrics;
    if (!m) return [];
    return [
      { label: 'Items', value: m.totalItems, icon: 'bi-box-seam', route: '/items' },
      { label: 'Customers', value: m.totalCustomers, icon: 'bi-people', route: '/customers' },
      { label: 'Orders', value: m.totalOrders, icon: 'bi-receipt', route: '/orders' },
      { label: 'Team members', value: m.totalUsers, icon: 'bi-person', route: '/users' },
      { label: 'Organizations', value: m.totalOrganizations, icon: 'bi-buildings', route: '/organizations' },
      { label: 'Licenses', value: m.totalLicenses, icon: 'bi-patch-check', route: '/licenses' },
      { label: 'Sales invoices', value: m.totalSalesInvoices, icon: 'bi-file-earmark-text', route: '/sales-invoices' },
    ].filter(row => this.auth.hasPermission(({ '/items': 'items.read', '/customers': 'organizations.read', '/orders': 'orders.read', '/users': 'users.read', '/organizations': 'organizations.read', '/licenses': 'licenses.read', '/sales-invoices': 'sales_invoices.read' } as Record<string, string>)[row.route]));
  }

  get healthServices(): Array<{ label: string; status: string; healthy: boolean }> {
    if (!this.health) return [];
    const services = this.health['services'] || this.health['checks'] || this.health;
    return Object.entries(services as Record<string, unknown>)
      .filter(([key, value]) => !['timestamp', 'uptime', 'version', 'environment', 'name'].includes(key) && (typeof value === 'string' || typeof value === 'boolean' || (value !== null && typeof value === 'object')))
      .map(([key, value]) => {
        const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['status'] ?? (value as Record<string, unknown>)['connected'] ?? 'Unknown' : value;
        const healthy = raw === true || ['ok', 'up', 'healthy', 'connected', 'ready'].includes(String(raw).toLowerCase());
        return { label: key.replace(/[_-]/g, ' '), healthy, status: healthy ? 'Operational' : raw === false ? 'Unavailable' : String(raw) };
      });
  }

  get canViewExpenses(): boolean { return this.auth.hasPermission('expenses.read'); }
  get visibleActionQueues(): ActionQueue[] {
    return this.actionQueues.filter(queue => queue.kind === 'invoices' ? this.canViewSalesInvoices : this.canViewExpenses);
  }
  get hasOrganization(): boolean { return Boolean(this.orgParamValue); }
  get canShowFinancials(): boolean { return this.canViewReports && this.canViewFinancialCharts && this.hasOrganization; }
  get quickLinks() {
    return [
      { label: 'New order', detail: 'Start a customer order', route: '/orders/create', icon: 'bi-plus-lg', permission: 'orders.create' },
      { label: 'Expenses', detail: 'Record and review spending', route: '/expenses', icon: 'bi-wallet2', permission: 'expenses.read' },
      { label: 'Sales invoices', detail: 'Manage customer billing', route: '/sales-invoices', icon: 'bi-file-earmark-text', permission: 'sales_invoices.read' },
      { label: 'Reports', detail: 'Explore your financial reports', route: '/reports', icon: 'bi-bar-chart', permission: 'reports.read' },
    ].filter(link => this.auth.hasPermission(link.permission));
  }
  get financialReady(): boolean { return !!this.monthlySummary && !this.chartLoading && !this.chartError; }
  get financialDifference(): number { return this.yearlySalesTotal - this.yearlyExpenseTotal; }
  get snapshotMonth(): MonthlyDataPoint | undefined {
    const month = this.selectedYear === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
    return this.monthlySummary?.months.find(row => row.month === month);
  }
  get chartEmpty(): boolean { return !!this.monthlySummary && this.monthlySummary.months.every(row => !row.sales && !row.expenses); }
  get monthlyRows(): MonthlyDataPoint[] { return this.monthlySummary?.months || []; }
  selectOrganization(): void { this.organizationContext.requestSelection(true); }
  statusClass(status: string): string {
    if (['paid', 'completed', 'approved'].includes(status)) return 'ui-badge-success';
    if (['void', 'cancelled', 'overdue'].includes(status)) return 'ui-badge-danger';
    if (['pending', 'submitted', 'partially_paid'].includes(status)) return 'ui-badge-warning';
    return 'ui-badge-secondary';
  }
  trackActivity(_index: number, row: ActivityRow): string { return row.kind + row.id; }

  get canViewItems(): boolean {
    return this.auth.hasPermission('items.read');
  }

  get canViewCustomers(): boolean {
    return this.auth.hasPermission('organizations.read');
  }

  get canViewOrders(): boolean {
    return this.auth.hasPermission('orders.read');
  }

  get canViewUsers(): boolean {
    return this.auth.hasPermission('users.read');
  }

  get canViewOrganizations(): boolean {
    return this.auth.hasPermission('organizations.read');
  }

  get canViewLicenses(): boolean {
    return this.auth.hasPermission('licenses.read');
  }

  get canViewSalesInvoices(): boolean {
    return this.auth.hasPermission('sales_invoices.read');
  }

  get canViewReports(): boolean {
    return this.auth.hasPermission('reports.read');
  }

  get canViewFinancialCharts(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return (
      roleCodes.includes('superuser') ||
      roleCodes.includes('administrator') ||
      roleCodes.includes('accountant')
    );
  }

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  get orgCurrency(): string {
    return this.normalizeCurrencyCode(this.chartCurrency || this.auth.currentUser()?.currency || 'USD');
  }

  private get orgParamValue(): string {
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (!organizationId) {
      return '';
    }
    if (this.isSuperuser && !this.organizationContext.shouldApplySuperuserScope()) {
      return '';
    }
    return organizationId;
  }

  ngOnInit(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    this.actionQueues.forEach(queue => queue.subscription?.unsubscribe());
    this.overviewSubscription?.unsubscribe();
    this.chartSubscription?.unsubscribe();
    this.destroyChart();
  }

  refresh(): void {
    this.actionQueues.forEach(queue => {
      queue.subscription?.unsubscribe();
      queue.data = null;
      queue.error = '';
      queue.loading = false;
    });
    this.visibleActionQueues.forEach(queue => this.loadActions(queue));
    this.loading = true;
    this.error = '';
    this.overviewSubscription?.unsubscribe();
    this.activityError = '';
    const orgParam = this.orgParamValue ? `&organizationId=${encodeURIComponent(this.orgParamValue)}` : '';
    const orgOnlyQuery = `?limit=1${orgParam}`;
    if (this.canShowFinancials) this.loadChart();

    this.overviewSubscription = forkJoin({
      health: this.api.get<Record<string, unknown>>('/api/v1').pipe(
        map((response) => response.data || null),
        catchError(() => of(null))
      ),
      totalItems: this.canViewItems ? this.fetchTotal(`/api/v1/items?limit=1${orgParam}`) : of(null),
      totalCustomers: this.canViewCustomers ? this.fetchTotal(`/api/v1/customers?limit=1${orgParam}`) : of(null),
      totalOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1${orgParam}`) : of(null),
      totalUsers: this.canViewUsers ? this.fetchTotal(`/api/v1/users?limit=1${orgParam}`) : of(null),
      totalOrganizations: this.canViewOrganizations ? this.fetchTotal(`/api/v1/organizations${orgOnlyQuery}`) : of(null),
      totalLicenses: this.canViewLicenses ? this.fetchTotal(`/api/v1/licenses${orgOnlyQuery}`) : of(null),
      totalSalesInvoices: this.canViewSalesInvoices ? this.fetchTotal(`/api/v1/sales-invoices?limit=1${orgParam}`) : of(null),
      pendingOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=pending${orgParam}`) : of(null),
      confirmedOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=confirmed${orgParam}`) : of(null),
      processingOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=processing${orgParam}`) : of(null),
      completedOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=completed${orgParam}`) : of(null),
      cancelledOrders: this.canViewOrders ? this.fetchTotal(`/api/v1/orders?limit=1&status=cancelled${orgParam}`) : of(null),
      approvedExpenses: this.canViewExpenses && this.hasOrganization ? this.fetchTotal(`/api/v1/expenses?limit=1&status=approved${orgParam}`) : of(null),
      recentInvoices: this.canViewSalesInvoices && this.hasOrganization ? this.fetchRecent(`/api/v1/sales-invoices?limit=6&sortBy=createdAt&sortDirection=DESC${orgParam}`) : of([] as RecentRecord[]),
      recentExpenses: this.canViewExpenses && this.hasOrganization ? this.fetchRecent(`/api/v1/expenses?limit=6${orgParam}`) : of([] as RecentRecord[]),
    }).subscribe({
      next: (result) => {
        this.loading = false;
        this.health = result.health;
        this.lastUpdated = new Date();
        this.workQueue = [
          ...(this.canViewOrders ? [{ label: 'Pending orders', count: result.pendingOrders, route: '/orders', status: 'pending', icon: 'bi-receipt', description: 'Awaiting confirmation' }] : []),
          ...(this.canViewExpenses && this.hasOrganization ? [
            { label: 'Expenses to pay', count: result.approvedExpenses, route: '/expenses', status: 'approved', icon: 'bi-wallet2', description: 'Approved, not yet marked paid' },
          ] : []),
        ];
        if (result.recentInvoices === null || result.recentExpenses === null) this.activityError = 'Some recent records could not be loaded. Refresh to try again.';
        this.recentActivity = [
          ...(result.recentInvoices || []).map(row => this.toActivity(row, 'Invoice')),
          ...(result.recentExpenses || []).map(row => this.toActivity(row, 'Expense')),
        ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 6);
        this.metrics = {
          totalItems: result.totalItems,
          totalCustomers: result.totalCustomers,
          totalOrders: result.totalOrders,
          totalUsers: result.totalUsers,
          totalOrganizations: result.totalOrganizations,
          totalLicenses: result.totalLicenses,
          totalSalesInvoices: result.totalSalesInvoices,
        };
        this.orderStatusCounts = this.canViewOrders
          ? [
              { label: 'Pending', value: result.pendingOrders, className: 'bg-warning' },
              { label: 'Confirmed', value: result.confirmedOrders, className: 'bg-brand' },
              { label: 'Processing', value: result.processingOrders, className: 'bg-brand-soft' },
              { label: 'Completed', value: result.completedOrders, className: 'bg-success' },
              { label: 'Cancelled', value: result.cancelledOrders, className: 'bg-danger' },
            ]
          : [];
        this.orderStatusMax = Math.max(1, ...this.orderStatusCounts.map((row) => row.value || 0));

      },
      error: () => {
        this.loading = false;
        this.error = 'Unable to load dashboard metrics.';
      },
    });
  }

  loadActions(queue: ActionQueue, page = 1): void {
    queue.subscription?.unsubscribe();
    if (!this.hasOrganization || !this.visibleActionQueues.includes(queue)) return;
    queue.loading = true;
    queue.error = '';
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const params = new URLSearchParams({ organizationId: this.orgParamValue, kind: queue.kind, page: String(page), today });
    queue.subscription = this.api.get<ActionPage>(`/api/v1/dashboard/action-center?${params}`).subscribe({
      next: response => {
        queue.loading = false;
        if (!response.data) {
          queue.data = null;
          queue.error = 'Actions are unavailable. Please try again.';
          return;
        }
        // A record may have been resolved while the user was on the last page.
        const lastPage = Math.max(1, Math.ceil(response.data.total / response.data.pageSize));
        if (page > lastPage) { this.loadActions(queue, lastPage); return; }
        queue.data = response.data;
      },
      error: () => {
        queue.loading = false;
        queue.data = null;
        queue.error = 'Actions could not be loaded. Please try again.';
      },
    });
  }

  setChartView(view: 'monthly' | 'quarterly'): void {
    if (this.chartView === view) {
      return;
    }
    this.chartView = view;
    this.renderSummary();
  }

  onYearChange(value: string): void {
    const parsed = Number(value);
    this.selectedYear = Number.isInteger(parsed) ? parsed : new Date().getFullYear();
    this.loadChart();
  }

  maxOrderStatusCount(): number {
    return this.orderStatusMax;
  }

  orderStatusWidth(value: number | null): number {
    return Math.round(((value || 0) / this.orderStatusMax) * 100);
  }

  trackByOrderStatus(_index: number, row: { label: string }): string {
    return row.label;
  }

  private loadChart(): void {
    if (!this.canShowFinancials) return;
    this.chartSubscription?.unsubscribe();
    this.monthlySummary = null;
    this.chartLoading = true;
    this.chartError = '';
    this.destroyChart();
    const params = new URLSearchParams({ year: String(this.selectedYear), organizationId: this.orgParamValue });
    this.chartSubscription = this.api.get<MonthlySummaryResponse>(`/api/v1/dashboard/monthly-summary?${params}`).subscribe({
      next: (response) => {
        this.chartLoading = false;
        if (!response.data) { this.chartError = 'Financial data is unavailable. Refresh to try again.'; return; }
        this.monthlySummary = response.data;
        this.chartCurrency = response.data.currency;
        this.yearlySalesTotal = response.data.totalSales;
        this.yearlyExpenseTotal = response.data.totalExpenses;
        this.renderSummary();
      },
      error: () => { this.chartLoading = false; this.chartError = 'Financial data could not be loaded. Refresh to try again.'; },
    });
  }

  private renderSummary(): void {
    if (!this.monthlySummary) return;
    const months = this.monthlySummary.months;
    if (this.chartView === 'monthly') {
      this.renderChart(months.map(row => row.monthName), months.map(row => row.sales), months.map(row => row.expenses));
    } else {
      const sales = [0, 0, 0, 0], expenses = [0, 0, 0, 0];
      for (const row of months) {
        const quarter = Math.floor((row.month - 1) / 3);
        if (quarter < 0 || quarter > 3) continue;
        sales[quarter] += Number(row.sales);
        expenses[quarter] += Number(row.expenses);
      }
      this.renderChart(['Q1', 'Q2', 'Q3', 'Q4'], sales, expenses);
    }
  }

  private fetchRecent(endpoint: string) {
    return this.api.list<RecentRecord>(endpoint).pipe(map(response => response.data || []), catchError(() => of(null)));
  }

  private toActivity(row: RecentRecord, kind: 'Invoice' | 'Expense'): ActivityRow {
    return {
      id: row.id, kind, label: (kind === 'Invoice' ? row.invoiceNumber : row.expenseNumber) || 'No reference',
      party: (kind === 'Invoice' ? row.order?.customer?.name : row.vendor?.name) || row.organization?.name || '—',
      route: kind === 'Invoice' ? '/sales-invoices' : '/expenses',
      date: kind === 'Invoice' ? row.issueDate : row.expenseDate,
      createdAt: row.createdAt, status: row.status || 'draft', amount: Number(row.totalAmount || 0), currency: row.currency || this.orgCurrency,
    };
  }

  private destroyChart(): void {
    if (this.salesExpenseChart) {
      this.salesExpenseChart.destroy();
      this.salesExpenseChart = null;
    }
  }

  private renderChart(labels: string[], sales: number[], expenses: number[]): void {
    const canvas = this.salesExpenseChartRef?.nativeElement;
    if (!canvas) return;

    this.destroyChart();

    this.zone.runOutsideAngular(() => {
    this.salesExpenseChart = new Chart<'bar', number[], string>(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Sales',
            data: sales,
            backgroundColor: '#7265df',
            borderColor: '#7265df',
            borderWidth: 0,
            borderRadius: 4,
            maxBarThickness: 24,
          },
          {
            label: 'Expenses',
            data: expenses,
            backgroundColor: '#b7b2dc',
            borderColor: '#b7b2dc',
            borderWidth: 0,
            borderRadius: 4,
            maxBarThickness: 24,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'bar'>) => {
                const value = Number(ctx.raw || 0);
                return `${ctx.dataset.label}: ${this.toCurrency(value, this.orgCurrency)}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#8993a5', font: { family: 'Inter', size: 11 } } },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: '#8993a518' },
            ticks: {
              color: '#8993a5', font: { family: 'Inter', size: 10 }, padding: 12,
              callback: (tickValue: string | number) =>
                this.toCurrency(Number(tickValue || 0), this.orgCurrency, 0, 0),
            },
          },
        },
      },
    });
    });
  }

  toCurrency(
    value: number | string | null | undefined,
    currency = 'USD',
    minimumFractionDigits = 2,
    maximumFractionDigits = 2
  ): string {
    const numeric = Number(value || 0);
    const safeCurrency = this.normalizeCurrencyCode(currency);
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: safeCurrency,
        minimumFractionDigits,
        maximumFractionDigits,
      }).format(Number.isFinite(numeric) ? numeric : 0);
    } catch (_err) {
      return `${safeCurrency} ${(Number.isFinite(numeric) ? numeric : 0).toFixed(2)}`;
    }
  }

  private normalizeCurrencyCode(currency: unknown): string {
    const raw = String(currency || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(raw) ? raw : 'USD';
  }

  private fetchTotal(endpoint: string) {
    return this.api.list<unknown>(endpoint).pipe(
      map((response: ApiResponse<unknown[]>) => Number(response.meta?.total || 0) || 0),
      catchError(() => of(null))
    );
  }
}
