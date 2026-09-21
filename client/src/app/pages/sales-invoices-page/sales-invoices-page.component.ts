import { ModalDirective } from '../../shared/modal.directive';
import { DropdownDirective } from '../../shared/dropdown.directive';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface SalesInvoiceRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
    taxType?: {
      id: string;
      code?: string;
      name?: string;
      description?: string;
      percentage?: number;
    };
  };
  orderId?: string;
  order?: {
    id: string;
    customerId?: string;
    customer?: {
      id: string;
      name?: string;
      contactPerson?: string;
      email?: string;
      phone?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    };
  };
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  amount?: number;
  taxableAmount?: number;
  withHoldingTaxAmount?: number;
  withholdingTaxTypeId?: string;
  withholdingTaxType?: {
    id?: string;
    code?: string;
    name?: string;
    percentage?: number;
    appliesTo?: string;
  };
  subtotalAmount?: number;
  taxAmount?: number;
  discountAmount?: number;
  scPwdDiscount?: number;
  serviceCharge?: number;
  totalAmount?: number;
  paidAt?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
}

interface SalesInvoiceImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  totalRows: number;
  errors: string[];
}

interface OrganizationTaxInfo {
  id: string;
  currency?: string;
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    description?: string;
    percentage?: number;
  };
}

interface WithholdingTaxTypeOption {
  id: string;
  code?: string;
  name: string;
  percentage: number;
  appliesTo?: string;
}

@Component({
  selector: 'app-sales-invoices-page',
  standalone: true,
  imports: [ModalDirective, DropdownDirective, OrganizationRequiredComponent, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './sales-invoices-page.component.html',
})
export class SalesInvoicesPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dashboardRoute = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  readonly rows = signal<SalesInvoiceRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly importModalError = signal('');
  readonly importSummary = signal<SalesInvoiceImportSummary | null>(null);
  searchQuery = '';
  statusFilter = '';
  paymentStatusFilter = '';
  issueDateFrom = '';
  issueDateTo = '';
  sortBy = 'createdAt';
  sortDirection: 'asc' | 'desc' = 'desc';
  page = 1;
  pageSize = 20;
  readonly pageSizeOptions = [10, 20, 50, 100];
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'sales-invoices-page';

  createInvoiceForm: FormGroup = this.newCreateInvoiceForm();
  private computeSub: Subscription | null = null;
  private importFile: File | null = null;
  forceImport = false;

  computedSubtotal = 0;
  computedTaxableAmount = 0;
  computedTaxAmount = 0;
  computedWithholdingTaxAmount = 0;
  computedTotalAmount = 0;
  scPwdEnabled = false;
  organizationCurrency = '';
  organizationTaxTypeCode = '';
  organizationTaxTypeName = '';
  organizationTaxRate = 12;
  readonly withholdingTaxTypes = signal<WithholdingTaxTypeOption[]>([]);
  readonly withholdingTaxLoading = signal(false);

  readonly sortIcon = computed(() =>
    this.sortDirection === 'asc' ? 'bi-sort-up-alt' : 'bi-sort-down-alt'
  );

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get currentOrganizationCurrency(): string {
    return String(this.organizationCurrency || this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get hasOrganizationContext(): boolean {
    return Boolean(this.currentOrganizationId.trim());
  }

  get isContextLocked(): boolean {
    return this.isSuperuser && !this.hasOrganizationContext;
  }

  get isPercentageTaxOrganization(): boolean {
    return this.isPercentageTaxType(this.organizationTaxTypeCode, this.organizationTaxTypeName);
  }

  get taxModeLabel(): string {
    if (this.isPercentageTaxOrganization) {
      return `Percentage Tax (${this.organizationTaxRate || 0}%)`;
    }
    return this.organizationTaxTypeName || `VAT (${this.organizationTaxRate || 12}%)`;
  }

  get computedPercentageTaxAmount(): number {
    if (!this.isPercentageTaxOrganization) {
      return 0;
    }
    return +((this.createInvoiceForm.get('amount')?.value || 0) * ((this.organizationTaxRate || 0) / 100)).toFixed(2);
  }


  ngOnInit(): void {
    this.restoreTablePreferences();
    const requestedStatus = this.dashboardRoute.snapshot.queryParamMap.get('status');
    if (requestedStatus && ['draft', 'issued', 'sent', 'paid', 'partially_paid', 'overdue', 'void'].includes(requestedStatus)) {
      this.statusFilter = requestedStatus;
      this.searchQuery = '';
      this.paymentStatusFilter = '';
      this.issueDateFrom = '';
      this.issueDateTo = '';
      this.page = 1;
    }
    this.loadOrganizationTaxInfo();
    this.loadWithholdingTaxTypes();
    this.load();
  }

  load(): void {
    if (this.isContextLocked) {
      this.loading.set(false);
      this.rows.set([]);
      this.total = 0;
      this.totalPages = 1;
      this.page = 1;
      this.error.set('');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
      sortBy: this.sortBy,
      sortDirection: this.sortDirection,
    });
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentStatusFilter) {
      params.set('paymentStatus', this.paymentStatusFilter);
    }
    if (this.issueDateFrom) {
      params.set('issueDateFrom', this.issueDateFrom);
    }
    if (this.issueDateTo) {
      params.set('issueDateTo', this.issueDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api.list<SalesInvoiceRow>(`/api/v1/sales-invoices?${params.toString()}`).subscribe({
      next: (response: ApiResponse<SalesInvoiceRow[]>) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
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
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load sales invoices.');
      },
    });
  }

  ngOnDestroy(): void {
    this.computeSub?.unsubscribe();
  }

  openCreateModal(): void {
    if (this.isContextLocked) return;
    this.createInvoiceForm = this.newCreateInvoiceForm();
    this.loadWithholdingTaxTypes();
    this.setupInvoiceAutoCompute();
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  openImportModal(): void {
    if (this.isContextLocked) return;
    this.importFile = null;
    this.forceImport = false;
    this.importModalError.set('');
    this.message.set('');
    this.error.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.importFile = null;
    this.forceImport = false;
    this.importModalError.set('');
  }

  async createInvoice(): Promise<void> {
    if (this.isContextLocked) {
      this.error.set('Select a specific organization before creating a sales invoice.');
      return;
    }
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.error.set('Select a specific organization before creating a sales invoice.');
        return;
      }
      this.error.set('Logged in user has no organization assigned.');
      return;
    }

    if (this.createInvoiceForm.invalid) {
      this.createInvoiceForm.markAllAsTouched();
      this.error.set('Please complete all required sales invoice fields.');
      return;
    }

    const issueDate = String(this.createInvoiceForm.get('issueDate')?.value || '').trim();
    if (issueDate && !this.isInCurrentQuarter(issueDate)) {
      const confirmed = await this.confirmDialog.confirm({
        title: 'Date Outside Current Quarter',
        message: `The issue date (${issueDate}) is not within the current quarter. This may affect your quarterly BIR filings. Are you sure you want to proceed?`,
        confirmText: 'Proceed Anyway',
        confirmButtonClass: 'ui-btn-warning',
        iconClass: 'bi-exclamation-triangle',
      });
      if (!confirmed) return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createInvoiceForm.getRawValue(),
      organizationId: this.currentOrganizationId,
    });

    this.api.create<SalesInvoiceRow>('/api/v1/sales-invoices', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Sales invoice created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create sales invoice.');
      },
    });
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importSalesInvoicesCsv(): void {
    if (this.isContextLocked) {
      this.importModalError.set('Select a specific organization before importing sales invoices.');
      return;
    }
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing sales invoices.');
      return;
    }

    this.submitting.set(true);
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');
    this.importSummary.set(null);

    const formData = new FormData();
    formData.append('file', this.importFile);
    if (this.forceImport) {
      formData.append('forceImport', 'true');
    }
    if (this.currentOrganizationId.trim()) {
      formData.append('organizationId', this.currentOrganizationId.trim());
    }

    this.api.createFormData<Record<string, unknown>>('/api/v1/sales-invoices/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        const data = (response.data || {}) as Record<string, unknown>;
        const imported = Number(data['imported'] || 0);
        const updated = Number(data['updated'] || 0);
        const skipped = Number(data['skipped'] || 0);
        const totalRows = Number(data['totalRows'] || imported + updated + skipped);
        const errors = Array.isArray(data['errors'])
          ? data['errors'].map((row) => String(row || '').trim()).filter((row) => row.length > 0)
          : [];
        this.importSummary.set({
          imported,
          updated,
          skipped,
          totalRows,
          errors,
        });
        this.message.set(response.message || `Imported ${imported}, updated ${updated}, skipped ${skipped}.`);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import sales invoices.');
      },
    });
  }

  clearImportSummary(): void {
    this.importSummary.set(null);
  }

  exportSalesInvoicesCsv(): void {
    if (this.isContextLocked) return;
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentStatusFilter) {
      params.set('paymentStatus', this.paymentStatusFilter);
    }
    if (this.issueDateFrom) {
      params.set('issueDateFrom', this.issueDateFrom);
    }
    if (this.issueDateTo) {
      params.set('issueDateTo', this.issueDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }
    params.set('sortBy', this.sortBy);
    params.set('sortDirection', this.sortDirection);

    this.api.download(`/api/v1/sales-invoices/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sales-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Sales invoices CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export sales invoices.');
      },
    });
  }

  async removeInvoice(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Sales Invoice',
      message: 'Delete this sales invoice? This action cannot be undone.',
      confirmText: 'Delete Invoice',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-file-earmark-x',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/sales-invoices', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Sales invoice deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete sales invoice.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  onFilterChange(): void {
    if (this.isContextLocked) return;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  applyIssueQuarterFilter(quarter: 1 | 2 | 3 | 4): void {
    if (this.isContextLocked) return;
    const range = this.quarterDateRange(quarter);
    this.issueDateFrom = range.from;
    this.issueDateTo = range.to;
    this.onFilterChange();
  }

  isIssueQuarterActive(quarter: 1 | 2 | 3 | 4): boolean {
    const range = this.quarterDateRange(quarter);
    return this.issueDateFrom === range.from && this.issueDateTo === range.to;
  }

  setSort(value: string): void {
    if (this.isContextLocked) return;
    this.sortBy = String(value || 'createdAt');
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  toggleSortDirection(): void {
    if (this.isContextLocked) return;
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  clearFilters(): void {
    if (this.isContextLocked) return;
    this.searchQuery = '';
    this.statusFilter = '';
    this.paymentStatusFilter = '';
    this.issueDateFrom = '';
    this.issueDateTo = '';
    this.sortBy = 'createdAt';
    this.sortDirection = 'desc';
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onPageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  goToPage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.persistTablePreferences();
    this.load();
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.searchQuery.trim() ||
      this.statusFilter ||
      this.paymentStatusFilter ||
      this.issueDateFrom ||
      this.issueDateTo
    );
  }

  get activeFilterCount(): number {
    let count = 0;
    if (this.searchQuery.trim()) count++;
    if (this.statusFilter) count++;
    if (this.paymentStatusFilter) count++;
    if (this.issueDateFrom || this.issueDateTo) count++;
    return count;
  }

  invoiceStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      draft: 'Draft', issued: 'Issued', sent: 'Sent',
      partially_paid: 'Partially Paid', paid: 'Paid',
      overdue: 'Overdue', void: 'Void',
    };
    return labels[value] || value;
  }

  paymentStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      unpaid: 'Unpaid', partially_paid: 'Partially Paid',
      paid: 'Paid', refunded: 'Refunded', failed: 'Failed',
    };
    return labels[value] || value;
  }

  organizationLabel(row: SalesInvoiceRow): string {
    if (row.organization?.name) return row.organization.name;
    if (row.organization?.legalName) return row.organization.legalName;
    return row.organizationId || '-';
  }

  invoiceStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
      case 'issued':
      case 'sent':
        return 'ui-badge-success';
      case 'partially_paid':
      case 'overdue':
        return 'ui-badge-warning';
      case 'void':
      case 'cancelled':
        return 'ui-badge-danger';
      case 'draft':
      default:
        return 'ui-badge-secondary';
    }
  }

  paymentStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'paid':
        return 'ui-badge-success';
      case 'partially_paid':
        return 'ui-badge-warning';
      case 'failed':
      case 'refunded':
        return 'ui-badge-danger';
      case 'unpaid':
      default:
        return 'ui-badge-secondary';
    }
  }

  formatMoney(value: unknown, currency: string): string {
    const amount = Number(value ?? 0);
    const normalized = Number.isFinite(amount) ? amount : 0;
    const code = String(currency || this.currentOrganizationCurrency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(normalized);
    } catch (_err) {
      return `${code} ${normalized.toFixed(2)}`;
    }
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.page = toPositiveInt(prefs['page'], this.page);
    this.pageSize = toPositiveInt(prefs['pageSize'], this.pageSize);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      page: this.page,
      pageSize: this.pageSize,
      viewMode: this.viewMode,
    });
  }

  trackById(_index: number, row: SalesInvoiceRow): string {
    return row.id;
  }

  private newInvoiceForm(): Record<string, unknown> {
    return {
      organizationId: '',
      orderId: '',
      invoiceNumber: '',
      issueDate: '',
      dueDate: '',
      status: 'draft',
      paymentStatus: 'unpaid',
      currency: this.currentOrganizationCurrency,
      amount: 0,
      taxableAmount: 0,
      withHoldingTaxAmount: 0,
      withholdingTaxTypeId: '',
      subtotalAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
      paidAt: '',
      notes: '',
      createdBy: '',
      updatedBy: '',
    };
  }

  private newCreateInvoiceForm(): FormGroup {
    const defaults = this.newInvoiceForm();
    return this.fb.group(
      {
        orderId: [defaults['orderId']],
        invoiceNumber: [defaults['invoiceNumber'], [Validators.required, Validators.maxLength(120)]],
        issueDate: [defaults['issueDate'], [Validators.required]],
        dueDate: [defaults['dueDate']],
        status: [defaults['status'], [Validators.required]],
        paymentStatus: [defaults['paymentStatus'], [Validators.required]],
        amount: [defaults['amount'], [Validators.required, Validators.min(0.01)]],
        discountAmount: [defaults['discountAmount'], [Validators.min(0)]],
        scPwdDiscount: [0, [Validators.min(0)]],
        serviceCharge: [0, [Validators.min(0)]],
        withholdingTaxTypeId: [defaults['withholdingTaxTypeId']],
        withHoldingTaxAmount: [defaults['withHoldingTaxAmount'], [Validators.min(0)]],
        subtotalAmount: [defaults['subtotalAmount']],
        taxableAmount: [defaults['taxableAmount']],
        taxAmount: [defaults['taxAmount']],
        totalAmount: [defaults['totalAmount']],
        paidAt: [defaults['paidAt']],
        notes: [defaults['notes'], [Validators.maxLength(2000)]],
      },
      { validators: [this.invoiceDateRangeValidator] }
    );
  }

  private invoiceDateRangeValidator(control: AbstractControl): ValidationErrors | null {
    const issueDate = String(control.get('issueDate')?.value || '').trim();
    const dueDate = String(control.get('dueDate')?.value || '').trim();
    if (!issueDate || !dueDate) {
      return null;
    }
    if (new Date(dueDate).getTime() < new Date(issueDate).getTime()) {
      return { invalidDateRange: true };
    }
    return null;
  }

  toggleScPwdDiscount(): void {
    if (this.isPercentageTaxOrganization) {
      this.scPwdEnabled = false;
      this.createInvoiceForm.patchValue({ scPwdDiscount: 0 });
      return;
    }
    this.scPwdEnabled = !this.scPwdEnabled;
    if (this.scPwdEnabled) {
      const amount = Math.max(0, Number(this.createInvoiceForm.get('amount')?.value) || 0);
      const subtotal = +(amount / 1.12).toFixed(2);
      this.createInvoiceForm.patchValue({ scPwdDiscount: +(subtotal * 0.20).toFixed(2) });
    } else {
      this.createInvoiceForm.patchValue({ scPwdDiscount: 0 });
    }
  }

  breakdownRow: SalesInvoiceRow | null = null;
  breakdownTop = 0;
  breakdownLeft = 0;
  customerPopoverRow: SalesInvoiceRow | null = null;
  customerPopoverTop = 0;
  customerPopoverLeft = 0;

  showBreakdown(event: MouseEvent, row: SalesInvoiceRow): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.breakdownRow = row;
    this.breakdownTop = rect.top;
    this.breakdownLeft = rect.right;
    requestAnimationFrame(() => {
      const popover = document.querySelector('.invoice-breakdown-popover.show') as HTMLElement;
      if (!popover) return;
      const popRect = popover.getBoundingClientRect();
      this.breakdownTop = rect.top - popRect.height;
      this.breakdownLeft = rect.right - popRect.width;
      if (this.breakdownTop < 4) this.breakdownTop = 4;
      if (this.breakdownLeft < 4) this.breakdownLeft = rect.left;
    });
  }

  hideBreakdown(): void {
    this.breakdownRow = null;
  }

  showCustomerPopover(event: MouseEvent, row: SalesInvoiceRow): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.customerPopoverRow = row;
    this.customerPopoverTop = rect.top;
    this.customerPopoverLeft = rect.left + rect.width / 2;
    requestAnimationFrame(() => {
      const popover = document.querySelector('.customer-popover.show') as HTMLElement;
      if (!popover) return;
      const popRect = popover.getBoundingClientRect();
      this.customerPopoverTop = rect.top - popRect.height - 6;
      this.customerPopoverLeft = rect.left + rect.width / 2 - popRect.width / 2;
      if (this.customerPopoverTop < 4) this.customerPopoverTop = rect.bottom + 6;
      if (this.customerPopoverLeft < 4) this.customerPopoverLeft = 4;
    });
  }

  hideCustomerPopover(): void {
    this.customerPopoverRow = null;
  }

  customerName(row: SalesInvoiceRow): string {
    return row.order?.customer?.name || '-';
  }

  withholdingTaxTypeLabel(row: SalesInvoiceRow): string {
    if (row.withholdingTaxType?.name) {
      return row.withholdingTaxType.name;
    }
    if (row.withholdingTaxType?.code) {
      return row.withholdingTaxType.code;
    }
    return row.withholdingTaxTypeId ? row.withholdingTaxTypeId : '-';
  }

  trackByWithholdingTaxTypeId(_index: number, row: WithholdingTaxTypeOption): string {
    return row.id;
  }

  customerAddress(c: SalesInvoiceRow['order']): string {
    const cust = c?.customer;
    if (!cust) return '';
    return [cust.addressLine1, cust.addressLine2, cust.city, cust.state, cust.postalCode, cust.country]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  computeSubtotal(row: SalesInvoiceRow): number {
    if (this.isPercentageTaxType(row.organization?.taxType?.code, row.organization?.taxType?.name)) {
      return +(row.amount ?? 0).toFixed(2);
    }
    return +((row.amount ?? 0) / 1.12).toFixed(2);
  }

  isPercentageTaxRow(row: SalesInvoiceRow): boolean {
    return this.isPercentageTaxType(row.organization?.taxType?.code, row.organization?.taxType?.name);
  }

  private loadOrganizationTaxInfo(): void {
    const orgId = this.currentOrganizationId.trim();
    if (!orgId) {
      this.organizationCurrency = '';
      this.organizationTaxTypeCode = '';
      this.organizationTaxTypeName = '';
      this.organizationTaxRate = 12;
      return;
    }

    this.api.get<OrganizationTaxInfo>(`/api/v1/organizations/${encodeURIComponent(orgId)}`).subscribe({
      next: (response) => {
        const taxType = response.data?.taxType;
        this.organizationCurrency = String(response.data?.currency || '').toUpperCase();
        this.organizationTaxTypeCode = String(taxType?.code || '').toUpperCase();
        this.organizationTaxTypeName = String(taxType?.name || taxType?.description || taxType?.code || '').trim();
        const rate = Number(taxType?.percentage || 0);
        this.organizationTaxRate = Number.isFinite(rate) && rate > 0 ? rate : 12;
        this.recomputeInvoiceBreakdown();
      },
      error: () => {
        this.organizationCurrency = '';
        this.organizationTaxTypeCode = '';
        this.organizationTaxTypeName = '';
        this.organizationTaxRate = 12;
      },
    });
  }

  private isPercentageTaxType(code: unknown, name = ''): boolean {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const normalizedName = String(name || '').trim().toUpperCase();
    return [
      'PT',
      'PERCENTAGE_TAX',
      'PERCENTAGE',
      'NONVAT',
      'NON_VAT',
    ].includes(normalizedCode)
      || normalizedName.includes('PERCENTAGE TAX')
      || normalizedName.includes('NON-VAT')
      || normalizedName.includes('NON VAT');
  }

  private loadWithholdingTaxTypes(): void {
    const orgId = this.currentOrganizationId.trim();
    if (!orgId) {
      this.withholdingTaxTypes.set([]);
      return;
    }
    this.withholdingTaxLoading.set(true);
    const params = new URLSearchParams({
      organizationId: orgId,
      activeOnly: 'true',
      appliesTo: 'invoice',
    });
    this.api.list<WithholdingTaxTypeOption>(`/api/v1/withholding-tax-types?${params.toString()}`).subscribe({
      next: (response) => {
        this.withholdingTaxLoading.set(false);
        this.withholdingTaxTypes.set(response.data || []);
        this.recomputeInvoiceBreakdown();
      },
      error: () => {
        this.withholdingTaxLoading.set(false);
        this.withholdingTaxTypes.set([]);
      },
    });
  }

  private isInCurrentQuarter(dateStr: string): boolean {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return true;
    const now = new Date();
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const dateQuarter = Math.floor(d.getMonth() / 3);
    return d.getFullYear() === now.getFullYear() && dateQuarter === currentQuarter;
  }

  private quarterDateRange(quarter: 1 | 2 | 3 | 4): { from: string; to: string } {
    const year = new Date().getFullYear();
    const startMonth = (quarter - 1) * 3;
    return {
      from: this.formatDateOnly(new Date(year, startMonth, 1)),
      to: this.formatDateOnly(new Date(year, startMonth + 3, 0)),
    };
  }

  private formatDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private setupInvoiceAutoCompute(): void {
    this.computeSub?.unsubscribe();
    this.recomputeInvoiceBreakdown();
    this.computeSub = this.createInvoiceForm.valueChanges.subscribe(() => {
      this.recomputeInvoiceBreakdown();
    });
  }

  private recomputeInvoiceBreakdown(): void {
    const amount = Math.max(0, Number(this.createInvoiceForm.get('amount')?.value) || 0);
    const discount = Math.max(0, Number(this.createInvoiceForm.get('discountAmount')?.value) || 0);
    const serviceCharge = Math.max(0, Number(this.createInvoiceForm.get('serviceCharge')?.value) || 0);
    const selectedWithholdingId = String(this.createInvoiceForm.get('withholdingTaxTypeId')?.value || '').trim();
    const withholdingTaxType = this.withholdingTaxTypes().find((row) => row.id === selectedWithholdingId);

    const taxRate = this.organizationTaxRate > 0 ? this.organizationTaxRate / 100 : 0.12;
    const subtotal = this.isPercentageTaxOrganization
      ? +amount.toFixed(2)
      : +(amount / (1 + taxRate)).toFixed(2);

    let scPwdDiscount = Math.max(0, Number(this.createInvoiceForm.get('scPwdDiscount')?.value) || 0);
    if (this.scPwdEnabled && !this.isPercentageTaxOrganization) {
      scPwdDiscount = +(subtotal * 0.20).toFixed(2);
      this.createInvoiceForm.patchValue({ scPwdDiscount }, { emitEvent: false });
    } else if (this.isPercentageTaxOrganization && scPwdDiscount > 0) {
      scPwdDiscount = 0;
      this.createInvoiceForm.patchValue({ scPwdDiscount: 0 }, { emitEvent: false });
    }

    const taxableAmount = +Math.max(0, subtotal - discount - scPwdDiscount).toFixed(2);
    const taxAmount = this.isPercentageTaxOrganization ? 0 : +(taxableAmount * taxRate).toFixed(2);
    const withholding = withholdingTaxType
      ? +(taxableAmount * (Number(withholdingTaxType.percentage || 0) / 100)).toFixed(2)
      : 0;
    const totalAmount = +(taxableAmount + taxAmount + serviceCharge - withholding).toFixed(2);

    this.computedSubtotal = subtotal;
    this.computedTaxableAmount = taxableAmount;
    this.computedTaxAmount = taxAmount;
    this.computedWithholdingTaxAmount = withholding;
    this.computedTotalAmount = totalAmount;

    this.createInvoiceForm.patchValue({
      subtotalAmount: subtotal,
      taxableAmount,
      taxAmount,
      withHoldingTaxAmount: withholding,
      totalAmount,
    }, { emitEvent: false });
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.asString(form['organizationId']),
      orderId: this.optionalString(form['orderId']),
      invoiceNumber: this.asString(form['invoiceNumber']),
      issueDate: this.asString(form['issueDate']),
      dueDate: this.optionalString(form['dueDate']),
      status: this.optionalString(form['status']),
      paymentStatus: this.optionalString(form['paymentStatus']),
      amount: this.optionalNumber(form['amount']),
      taxableAmount: this.optionalNumber(form['taxableAmount']),
      withHoldingTaxAmount: this.optionalNumber(form['withHoldingTaxAmount']),
      withholdingTaxTypeId: this.optionalString(form['withholdingTaxTypeId']),
      subtotalAmount: this.optionalNumber(form['subtotalAmount']),
      taxAmount: this.optionalNumber(form['taxAmount']),
      discountAmount: this.optionalNumber(form['discountAmount']),
      scPwdDiscount: this.optionalNumber(form['scPwdDiscount']),
      serviceCharge: this.optionalNumber(form['serviceCharge']),
      totalAmount: this.optionalNumber(form['totalAmount']),
      paidAt: this.optionalString(form['paidAt']),
      notes: this.optionalString(form['notes']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };
  }

  private asString(value: unknown): string {
    return String(value || '').trim();
  }

  private optionalString(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

}
