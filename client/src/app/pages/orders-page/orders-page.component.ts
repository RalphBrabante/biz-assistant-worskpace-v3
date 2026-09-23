import { CommonModule } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { OrderBoardComponent } from './board/order-board.component';
import { TooltipDirective } from '../../shared/tooltip.directive';

@Component({
  selector: 'app-orders-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TooltipDirective, OrderBoardComponent],
  templateUrl: './orders-page.component.html',
})
export class OrdersPageComponent {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  queueFilter = "";
  private initialized = false;
  private loadGeneration = 0;
  constructor() { effect(() => { this.organizationContext.selectedOrganizationId(); if (this.initialized) { this.page = 1; this.load(); } }); }
  private readonly dashboardRoute = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  rows: Record<string, unknown>[] = [];
  loading = false;
  deletingId = '';
  error = '';
  searchQuery = '';
  statusFilter = '';
  paymentFilter = '';
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  total = 0;
  totalPages = 1;
  viewMode: TableViewMode | 'board' = 'board';
  boardRefreshKey = 0;
  boardBusy = false;
  get activeOrganizationId(): string { return this.organizationContext.getActiveOrganizationId(); }
  private readonly tablePrefsKey = 'orders-page';
  private readonly currencyFormatterCache = new Map<string, Intl.NumberFormat>();

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  ngOnInit(): void {
    this.initialized = true;
    this.restoreTablePreferences();
    const requestedStatus = this.dashboardRoute.snapshot.queryParamMap.get('status');
    if (requestedStatus && ['pending', 'confirmed', 'processing', 'completed', 'cancelled'].includes(requestedStatus)) {
      this.statusFilter = requestedStatus;
      this.searchQuery = '';
      this.page = 1;
      this.paymentFilter = '';
    }
    this.load();
  }

  load(): void {
    const generation = ++this.loadGeneration;
    this.error = "";
    if (this.viewMode === 'board') { this.loading = false; this.boardRefreshKey++; return; }
    this.loading = true;
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (organizationId) params.set("organizationId", organizationId);
    if (this.queueFilter) params.set("view", this.queueFilter);
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentFilter) {
      params.set('paymentStatus', this.paymentFilter);
    }

    this.api.list<Record<string, unknown>>(`/api/v1/orders?${params.toString()}`).subscribe({
      next: (response: ApiResponse<Record<string, unknown>[]>) => {
        if (generation !== this.loadGeneration) return;
        this.loading = false;
        this.rows = response.data || [];
        const meta = response.meta || {};
        this.total = Number(meta.total || 0);
        this.totalPages = Math.max(1, Number(meta.totalPages || 1));
        this.page = Math.max(1, Number(meta.page || this.page));
        this.persistTablePreferences();
        if (this.page > this.totalPages) {
          this.page = this.totalPages;
          this.load();
        }
      },
      error: (err) => {
        if (generation !== this.loadGeneration) return;
        this.loading = false;
        this.error = err?.error?.message || 'Unable to load orders.';
      },
    });
  }

  async remove(id: unknown): Promise<void> {
    const orderId = String(id || '');
    if (!orderId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Order',
      message: 'Delete this order? This action cannot be undone.',
      confirmText: 'Delete Order',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-receipt-cutoff',
    });
    if (!confirmed) {
      return;
    }

    this.deletingId = orderId;
    const revision = this.rows.find(row => row['id'] === orderId)?.['revision'];
    this.api.remove('/api/v1/orders', `${orderId}?revision=${revision}`).subscribe({
      next: () => {
        this.deletingId = '';
        this.load();
      },
      error: (err) => {
        this.deletingId = '';
        this.error = err?.error?.message || 'Unable to delete order.';
      },
    });
  }

  orderedCount(row: Record<string, unknown>): number {
    const snapshots = row['orderedItemSnapshots'];
    if (Array.isArray(snapshots)) {
      return snapshots.length;
    }
    return 0;
  }

  orderStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'completed':
      case 'fulfilled':
        return 'ui-badge-success';
      case 'confirmed':
      case 'processing':
        return 'ui-badge-primary';
      case 'pending':
      case 'draft':
        return 'ui-badge-warning';
      case 'cancelled':
      case 'refunded':
        return 'ui-badge-danger';
      default:
        return 'ui-badge-secondary';
    }
  }

  orderPaymentBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return 'ui-badge-success';
      case 'partially_paid':
      case 'partial':
        return 'ui-badge-info';
      case 'refunded':
        return 'ui-badge-warning';
      case 'failed':
        return 'ui-badge-danger';
      case 'unpaid':
      default:
        return 'ui-badge-secondary';
    }
  }

  organizationLabel(row: Record<string, unknown>): string {
    const org = row['organization'] as { name?: string; legalName?: string } | undefined;
    return org?.name || org?.legalName || String(row['organizationId'] || '-') || '-';
  }

  formatMoney(value: unknown, row?: Record<string, unknown>): string {
    const amount = Number(value ?? 0);
    const code = String(row?.['currency'] || 'USD').toUpperCase();
    const normalizedAmount = Number.isFinite(amount) ? amount : 0;
    const formatter = this.currencyFormatterCache.get(code);
    if (formatter) {
      return formatter.format(normalizedAmount);
    }

    try {
      const created = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      this.currencyFormatterCache.set(code, created);
      return created.format(normalizedAmount);
    } catch (_err) {
      return `${code} ${normalizedAmount.toFixed(2)}`;
    }
  }

  trackById(_index: number, row: Record<string, unknown>): string {
    return String(row['id'] || _index);
  }

  onSearchChange(value: string): void {
    this.searchQuery = value;
    this.page = 1;
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  get hasActiveFilters(): boolean {
    return !!(this.searchQuery.trim() || this.statusFilter || this.paymentFilter || this.queueFilter);
  }

  get activeFilterCount(): number {
    let count = 0;
    if (this.searchQuery.trim()) count++;
    if (this.statusFilter) count++;
    if (this.paymentFilter) count++;
    if (this.queueFilter) count++;
    return count;
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.statusFilter = '';
    this.paymentFilter = '';
    this.queueFilter = '';
    this.page = 1;
    this.load();
  }

  stateLabel(value: unknown): string { return String(value || '').replace(/_/g, ' '); }

  orderStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing',
      fulfilled: 'Fulfilled', completed: 'Completed', refunded: 'Refunded', cancelled: 'Cancelled',
    };
    return labels[value] || value;
  }

  orderPaymentLabel(value: string): string {
    const labels: Record<string, string> = { unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Paid', refunded: 'Refunded' };
    return labels[value] || value;
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  setViewMode(mode: TableViewMode | 'board'): void {
    if (this.boardBusy || mode === this.viewMode) return;
    this.viewMode = mode; this.page = 1;
    this.persistTablePreferences(); this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading) {
      return;
    }
    this.page = page;
    this.persistTablePreferences();
    this.load();
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.page = toPositiveInt(prefs['page'], this.page);
    this.pageSize = toPositiveInt(prefs['pageSize'], this.pageSize);
    this.viewMode = prefs['viewMode'] === 'table' || prefs['viewMode'] === 'card' ? toTableViewMode(prefs['viewMode']) : 'board';
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      page: this.page,
      pageSize: this.pageSize,
      viewMode: this.viewMode,
    });
  }
}
