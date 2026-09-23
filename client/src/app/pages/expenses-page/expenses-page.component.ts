import { CountrySelectComponent } from '../../shared/country-select.component';
import { getBrowserCountry } from '../../shared/countries';
import { ModalDirective } from '../../shared/modal.directive';
import { DropdownDirective } from '../../shared/dropdown.directive';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { computeExpenseAmounts, isVatTaxType } from '../../core/expense-calculation';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface ExpenseRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  vendorId: string;
  vendorTaxId?: string;
  expenseNumber?: string;
  vatExemptAmount?: number;
  receiptVatAmount?: number | null;
  withholdingTaxBase?: number | null;
  taxableAmount?: number;
  withHoldingTaxAmount?: number;
  category: string;
  description?: string;
  expenseDate: string;
  dueDate?: string;
  status?: string;
  paymentMethod?: string;
  currency?: string;
  amount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  file?: string;
  fileCdnUrl?: string;
  notes?: string;
  vendor?: {
    id: string;
    name?: string;
    taxId?: string;
    contactPerson?: string;
    phone?: string;
    contactEmail?: string;
    addressLine1?: string;
    addressLine2?: string;
    barangay?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  taxTypeId?: string;
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    description?: string;
    percentage?: number;
  };
  withholdingTaxTypeId?: string;
  withholdingTaxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
}

interface VendorOption {
  id: string;
  organizationId?: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  name: string;
  category?: string;
  legalName?: string;
  taxId?: string;
  status?: string;
}

interface WithholdingTaxTypeOption {
  minimumBaseAmount?: number | string;
  id: string;
  organizationId: string;
  code: string;
  name: string;
  percentage: number;
  appliesTo?: 'expense' | 'invoice' | 'both';
  isActive?: boolean;
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
  currency?: string;
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

interface ExpenseImportSummary {
  imported: number;
  skipped: number;
  totalRows: number;
  errors: string[];
}

@Component({
  selector: 'app-expenses-page',
  standalone: true,
  imports: [CountrySelectComponent, ModalDirective, DropdownDirective, OrganizationRequiredComponent, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './expenses-page.component.html',
})
export class ExpensesPageComponent {
  private readonly api = inject(ApiService);
  private readonly dashboardRoute = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  readonly rows = signal<ExpenseRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly transferringId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly isTransferModalOpen = signal(false);
  readonly exporting = signal(false);
  readonly loadingTransferTargets = signal(false);
  readonly loadingVendors = signal(false);
  readonly vendors = signal<VendorOption[]>([]);
  readonly withholdingTaxTypes = signal<WithholdingTaxTypeOption[]>([]);
  readonly transferTargetOrganizations = signal<OrganizationOption[]>([]);
  readonly vendorSearch = signal('');
  readonly selectedCreateVendor = signal<VendorOption | null>(null);
  readonly vendorDropdownOpen = signal(false);
  readonly isVendorCreateModalOpen = signal(false);
  readonly creatingVendor = signal(false);
  readonly vendorCreateError = signal('');
  readonly createFileName = signal('');

  readonly message = signal('');
  readonly error = signal('');
  readonly createModalError = signal('');
  readonly importModalError = signal('');
  readonly transferModalError = signal('');
  readonly importSummary = signal<ExpenseImportSummary | null>(null);
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'expenses-page';
  searchQuery = '';
  statusFilter = '';
  paymentMethodFilter = '';
  expenseDateFrom = '';
  expenseDateTo = '';
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  readonly pageSizeOptions = [10, 20, 50, 100];

  createExpenseForm: FormGroup = this.newCreateExpenseForm();
  private expenseComputeSub: Subscription | null = null;
  private taxContextSub?: Subscription;
  taxContextLoading = true;
  taxContextError = '';
  calculationError = '';
  computedReceiptVatAmount = 0;
  computedWithholdingBase = 0;
  computedVatExclusive = 0;
  computedVatableInclusive = 0;
  computedTaxableAmount = 0;
  computedTaxAmount = 0;
  computedWithholdingTaxAmount = 0;
  computedTotalAmount = 0;
  vendorCreateForm: FormGroup = this.newVendorCreateForm();
  editingId = '';
  transferRow: ExpenseRow | null = null;
  selectedTransferOrganizationId = '';
  private readonly vendorSearchInput$ = new Subject<string>();
  private vendorSearchSub?: Subscription;
  private createFile: File | null = null;
  private importFile: File | null = null;
  organizationCurrency = '';
  organizationTaxTypeCode = '';
  organizationTaxTypeName = '';
  organizationTaxRate = 0;

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get currentUserId(): string {
    return this.auth.currentUser()?.id || '';
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

  get isVatOrganization(): boolean {
    return isVatTaxType({ code: this.organizationTaxTypeCode, name: this.organizationTaxTypeName });
  }

  get taxModeLabel(): string {
    return this.organizationTaxTypeName || 'Tax settings unavailable';
  }

  get canSaveExpense(): boolean {
    return !this.submitting() && !this.taxContextLoading && !this.taxContextError && !this.calculationError;
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    const requestedStatus = this.dashboardRoute.snapshot.queryParamMap.get('status');
    if (requestedStatus && ['draft', 'submitted', 'approved', 'paid', 'cancelled'].includes(requestedStatus)) {
      this.statusFilter = requestedStatus;
      this.searchQuery = '';
      this.page = 1;
      this.paymentMethodFilter = '';
      this.expenseDateFrom = '';
      this.expenseDateTo = '';
    }
    this.loadOrganizationTaxInfo();
    this.load();
    this.vendorSearchSub = this.vendorSearchInput$
      .pipe(debounceTime(350), distinctUntilChanged())
      .pipe(
        switchMap((value) => {
          if (!this.currentOrganizationId) {
            this.loadingVendors.set(false);
            return of([] as VendorOption[]);
          }

          const cleaned = String(value || '').trim();
          if (cleaned.length > 0 && cleaned.length < 2) {
            this.loadingVendors.set(false);
            return of([] as VendorOption[]);
          }

          this.loadingVendors.set(true);
          const params = new URLSearchParams({
            limit: '20',
            activeOnly: 'true',
            includeShared: 'true',
          });
          if (this.currentOrganizationId) {
            params.set('organizationId', this.currentOrganizationId);
          }
          if (cleaned) {
            params.set('q', cleaned);
          }

          return this.api.list<VendorOption>(`/api/v1/vendors?${params.toString()}`).pipe(
            map((response: ApiResponse<VendorOption[]>) => response.data || []),
            catchError(() => of([] as VendorOption[]))
          );
        })
      )
      .subscribe((vendors) => {
        this.loadingVendors.set(false);
        this.vendors.set(vendors);
      });
  }

  ngOnDestroy(): void {
    this.taxContextSub?.unsubscribe();
    this.vendorSearchSub?.unsubscribe();
    this.expenseComputeSub?.unsubscribe();
  }

  load(resetPage = false): void {
    if (this.isContextLocked) {
      this.loading.set(false);
      this.rows.set([]);
      this.total = 0;
      this.totalPages = 1;
      this.page = 1;
      this.error.set('');
      return;
    }
    if (!this.currentOrganizationId && !this.organizationContext.isAllOrganizationsSelected()) {
      this.error.set('Logged in user has no organization assigned.');
      this.rows.set([]);
      return;
    }
    if (resetPage) {
      this.page = 1;
    }

    this.loading.set(true);
    this.error.set('');

    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    const q = this.searchQuery.trim();
    if (q) {
      params.set('q', q);
    }
    if (this.statusFilter) {
      params.set('status', this.statusFilter);
    }
    if (this.paymentMethodFilter) {
      params.set('paymentMethod', this.paymentMethodFilter);
    }
    if (this.expenseDateFrom) {
      params.set('expenseDateFrom', this.expenseDateFrom);
    }
    if (this.expenseDateTo) {
      params.set('expenseDateTo', this.expenseDateTo);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api.list<ExpenseRow>(`/api/v1/expenses?${params.toString()}`).subscribe({
        next: (response) => {
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
          this.error.set(err?.error?.message || 'Unable to load expenses.');
        },
      });
  }

  loadWithholdingTaxTypes(): void { this.loadOrganizationTaxInfo(); }

  loadOrganizationTaxInfo(): void {
    this.taxContextSub?.unsubscribe();
    this.taxContextLoading = true;
    this.taxContextError = '';
    const orgId = this.currentOrganizationId.trim();
    if (!orgId) {
      this.taxContextLoading = false;
      this.taxContextError = 'Select an organization first.';
      return;
    }
    this.taxContextSub = this.api.get<{ organization: OrganizationTaxInfo; withholdingTaxTypes: WithholdingTaxTypeOption[] }>(
      `/api/v1/expenses/tax-context?organizationId=${encodeURIComponent(orgId)}`
    ).subscribe({
      next: (response) => {
        const organization = response.data?.organization;
        const taxType = organization?.taxType;
        if (!taxType || organization?.id !== orgId) {
          this.taxContextLoading = false;
          this.taxContextError = 'Organization tax settings are unavailable. Please retry.';
          return;
        }
        this.organizationCurrency = String(organization?.currency || '').toUpperCase();
        this.organizationTaxTypeCode = String(taxType.code || '').toUpperCase();
        this.organizationTaxTypeName = String(taxType.name || taxType.code || '').trim();
        this.organizationTaxRate = Number(taxType.percentage || 0);
        this.withholdingTaxTypes.set(response.data?.withholdingTaxTypes || []);
        this.taxContextLoading = false;
        this.recomputeExpenseBreakdown();
      },
      error: (err) => {
        this.taxContextLoading = false;
        this.taxContextError = err?.error?.message || 'Unable to load organization tax settings. Please retry.';
      },
    });
  }

  isPercentageTaxRow(row: ExpenseRow): boolean {
    return this.isPercentageTaxType(row.taxType?.code, row.taxType?.name || row.taxType?.description || '');
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

  openCreateModal(): void {
    if (this.isContextLocked) return;
    this.editingId = '';
    this.createExpenseForm = this.newCreateExpenseForm();
    this.setupExpenseAutoCompute();
    this.loadWithholdingTaxTypes();
    this.vendorSearch.set('');
    this.selectedCreateVendor.set(null);
    this.vendors.set([]);
    this.vendorDropdownOpen.set(false);
    this.isVendorCreateModalOpen.set(false);
    this.vendorCreateError.set('');
    this.createFile = null;
    this.createFileName.set('');
    this.vendorCreateForm = this.newVendorCreateForm();
    this.loadingVendors.set(false);
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
    this.vendorSearch.set('');
    this.selectedCreateVendor.set(null);
    this.vendors.set([]);
    this.vendorDropdownOpen.set(false);
    this.isVendorCreateModalOpen.set(false);
    this.vendorCreateError.set('');
    this.createModalError.set('');
    this.createFile = null;
    this.createFileName.set('');
    this.vendorCreateForm = this.newVendorCreateForm();
  }

  openImportModal(): void {
    if (this.isContextLocked) return;
    this.importFile = null;
    this.importModalError.set('');
    this.message.set('');
    this.error.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.importFile = null;
    this.importModalError.set('');
  }

  async createExpense(): Promise<void> {
    if (!this.canSaveExpense) return;
    if (this.isContextLocked) {
      this.createModalError.set('Select a specific organization before creating an expense.');
      return;
    }
    if (!this.currentOrganizationId) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.createModalError.set('Select a specific organization before creating an expense.');
        return;
      }
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }
    if (this.createExpenseForm.invalid) {
      this.createExpenseForm.markAllAsTouched();
      this.createModalError.set('Please complete all required fields.');
      return;
    }

    const vendorId = String(this.createExpenseForm.value['vendorId'] || '').trim();
    if (!vendorId) {
      this.createExpenseForm.get('vendorId')?.markAsTouched();
      this.createModalError.set('Please select a vendor from search results.');
      return;
    }

    const expenseDate = String(this.createExpenseForm.get('expenseDate')?.value || '').trim();
    if (expenseDate && !this.isInCurrentQuarter(expenseDate)) {
      const confirmed = await this.confirmDialog.confirm({
        title: 'Date Outside Current Quarter',
        message: `The expense date (${expenseDate}) is not within the current quarter. This may affect your quarterly BIR filings. Are you sure you want to proceed?`,
        confirmText: 'Proceed Anyway',
        confirmButtonClass: 'ui-btn-warning',
        iconClass: 'bi-exclamation-triangle',
      });
      if (!confirmed) return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');

    const payload = this.buildPayload({
      ...this.createExpenseForm.getRawValue(),
      organizationId: this.currentOrganizationId,
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    });
    const formData = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }
    if (this.createFile) {
      formData.append('file', this.createFile);
    }

    this.api.createFormData<ExpenseRow>('/api/v1/expenses', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Expense created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create expense.');
      },
    });
  }

  startEdit(row: ExpenseRow): void {
    if (this.isContextLocked) return;
    this.editingId = row.id;
    this.createFile = null;
    this.createFileName.set('');
    this.createExpenseForm = this.newCreateExpenseForm();
    this.createExpenseForm.patchValue({
      vendorId: row.vendorId || '',
      vendorTaxId: row.vendorTaxId || '',
      expenseNumber: row.expenseNumber || '',
      vatExemptAmount: row.vatExemptAmount ?? 0,
      receiptVatAmount: row.receiptVatAmount ?? null,
      withholdingTaxTypeId: row.withholdingTaxTypeId || row.withholdingTaxType?.id || '',
      category: row.category || '',
      description: row.description || '',
      expenseDate: row.expenseDate || '',
      dueDate: row.dueDate || '',
      status: row.status || 'draft',
      paymentMethod: row.paymentMethod || 'bank_transfer',
      amount: row.amount ?? 0,
      discountAmount: row.discountAmount ?? 0,
      serviceCharge: (row as any).serviceCharge ?? 0,
      notes: row.notes || '',
    });
    if (row.vendor) {
      this.selectedCreateVendor.set(row.vendor as VendorOption);
      this.vendorSearch.set(row.vendor.name || '');
    } else {
      this.selectedCreateVendor.set(null);
      this.vendorSearch.set('');
    }
    this.setupExpenseAutoCompute();
    this.loadWithholdingTaxTypes();
    this.createModalError.set('');
    this.isCreateModalOpen.set(true);
  }

  cancelEdit(): void {
    this.editingId = '';
    this.createModalError.set('');
    this.isCreateModalOpen.set(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.canSaveExpense) return;
    if (this.isContextLocked) return;
    if (!this.editingId) return;

    if (this.createExpenseForm.invalid) {
      this.createExpenseForm.markAllAsTouched();
      this.createModalError.set('Please complete all required fields.');
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Expense',
      message: 'Save changes to this expense?',
      confirmText: 'Update Expense',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) return;

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');
    this.createModalError.set('');

    const payload = this.buildPayload({
      ...this.createExpenseForm.getRawValue(),
      organizationId: this.currentOrganizationId,
      updatedBy: this.currentUserId,
    });
    const formData = new FormData();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }
    if (this.createFile) {
      formData.append('file', this.createFile);
    }
    this.api.putFormData<ExpenseRow>(`/api/v1/expenses/${this.editingId}`, formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Expense updated successfully.');
        this.cancelEdit();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to update expense.');
      },
    });
  }

  async removeExpense(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Expense',
      message: 'Delete this expense? This action cannot be undone.',
      confirmText: 'Delete Expense',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-cash-stack',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/expenses', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Expense deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete expense.');
      },
    });
  }

  openTransferModal(row: ExpenseRow): void {
    if (this.isContextLocked) return;
    this.transferRow = row;
    this.selectedTransferOrganizationId = '';
    this.transferModalError.set('');
    this.transferTargetOrganizations.set([]);
    this.loadingTransferTargets.set(true);
    this.isTransferModalOpen.set(true);

    const params = new URLSearchParams();
    if (row.organizationId) {
      params.set('excludeOrganizationId', row.organizationId);
    }

    this.api.get<OrganizationOption[]>(`/api/v1/expenses/transfer-targets?${params.toString()}`).subscribe({
      next: (response) => {
        this.loadingTransferTargets.set(false);
        const organizations = response.data || [];
        this.transferTargetOrganizations.set(organizations);
        if (organizations.length === 1) {
          this.selectedTransferOrganizationId = organizations[0].id;
        }
      },
      error: (err) => {
        this.loadingTransferTargets.set(false);
        this.transferModalError.set(err?.error?.message || 'Unable to load transfer target organizations.');
      },
    });
  }

  closeTransferModal(): void {
    if (this.transferringId()) return;
    this.isTransferModalOpen.set(false);
    this.transferRow = null;
    this.selectedTransferOrganizationId = '';
    this.transferModalError.set('');
    this.transferTargetOrganizations.set([]);
  }

  async transferExpense(): Promise<void> {
    const row = this.transferRow;
    const targetOrganizationId = String(this.selectedTransferOrganizationId || '').trim();
    if (!row?.id) {
      this.transferModalError.set('Expense is required.');
      return;
    }
    if (!targetOrganizationId) {
      this.transferModalError.set('Select a target organization.');
      return;
    }

    const target = this.transferTargetOrganizations().find((organization) => organization.id === targetOrganizationId);
    const confirmed = await this.confirmDialog.confirm({
      title: 'Transfer Expense',
      message: `Transfer this expense to ${this.organizationOptionLabel(target)}?`,
      confirmText: 'Transfer Expense',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-arrow-left-right',
    });
    if (!confirmed) return;

    this.transferringId.set(row.id);
    this.transferModalError.set('');
    this.error.set('');
    this.message.set('');

    this.api.create<ExpenseRow>(`/api/v1/expenses/${row.id}/transfer`, {
      targetOrganizationId,
    }).subscribe({
      next: (response) => {
        this.transferringId.set('');
        this.message.set(response.message || 'Expense transferred successfully.');
        this.closeTransferModal();
        this.load();
      },
      error: (err) => {
        this.transferringId.set('');
        this.transferModalError.set(err?.error?.message || 'Unable to transfer expense.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  applyFilters(): void {
    if (this.isContextLocked) return;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  applyExpenseQuarterFilter(quarter: 1 | 2 | 3 | 4): void {
    if (this.isContextLocked) return;
    const range = this.quarterDateRange(quarter);
    this.expenseDateFrom = range.from;
    this.expenseDateTo = range.to;
    this.applyFilters();
  }

  isExpenseQuarterActive(quarter: 1 | 2 | 3 | 4): boolean {
    const range = this.quarterDateRange(quarter);
    return this.expenseDateFrom === range.from && this.expenseDateTo === range.to;
  }

  get hasActiveFilters(): boolean {
    return !!(this.searchQuery.trim() || this.statusFilter || this.paymentMethodFilter || this.expenseDateFrom || this.expenseDateTo);
  }

  get activeFilterCount(): number {
    let count = 0;
    if (this.searchQuery.trim()) count++;
    if (this.statusFilter) count++;
    if (this.paymentMethodFilter) count++;
    if (this.expenseDateFrom || this.expenseDateTo) count++;
    return count;
  }

  expenseStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      draft: 'Draft', submitted: 'Submitted', approved: 'Approved', paid: 'Paid', cancelled: 'Cancelled',
    };
    return labels[value] || value;
  }

  expensePaymentMethodLabel(value: string): string {
    const labels: Record<string, string> = {
      cash: 'Cash', bank_transfer: 'Bank Transfer', check: 'Check', card: 'Card', other: 'Other',
    };
    return labels[value] || value;
  }

  clearFilters(): void {
    if (this.isContextLocked) return;
    this.searchQuery = '';
    this.statusFilter = '';
    this.paymentMethodFilter = '';
    this.expenseDateFrom = '';
    this.expenseDateTo = '';
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

  organizationLabel(row: ExpenseRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  organizationOptionLabel(organization?: OrganizationOption): string {
    if (!organization) return 'the selected organization';
    return organization.name || organization.legalName || organization.id || 'the selected organization';
  }

  vendorLabel(row: ExpenseRow): string {
    return row.vendor?.name || row.vendorTaxId || row.vendorId || '-';
  }

  vendorOrganizationLabel(vendor: VendorOption): string {
    return vendor.organization?.name || vendor.organization?.legalName || vendor.organizationId || '';
  }

  taxTypeLabel(row: ExpenseRow): string {
    if (row.taxType?.name) return row.taxType.name;
    if (row.taxType?.code) return row.taxType.code;
    return '-';
  }

  withholdingTaxTypeLabel(row: ExpenseRow): string {
    if (row.withholdingTaxType?.name) return row.withholdingTaxType.name;
    if (row.withholdingTaxType?.code) return row.withholdingTaxType.code;
    return '-';
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

  breakdownRow: ExpenseRow | null = null;
  breakdownTop = 0;
  breakdownLeft = 0;

  vendorPopoverRow: ExpenseRow | null = null;
  vendorPopoverTop = 0;
  vendorPopoverLeft = 0;

  showBreakdown(event: MouseEvent, row: ExpenseRow): void {
    const cell = event.currentTarget as HTMLElement;
    const rect = cell.getBoundingClientRect();
    this.breakdownTop = rect.top - 8;
    this.breakdownLeft = rect.right;
    this.breakdownRow = row;

    requestAnimationFrame(() => {
      const popover = document.querySelector('.expense-breakdown-popover.show') as HTMLElement;
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

  showVendorPopover(event: MouseEvent, row: ExpenseRow): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.vendorPopoverRow = row;
    this.vendorPopoverTop = rect.top;
    this.vendorPopoverLeft = rect.left + rect.width / 2;

    requestAnimationFrame(() => {
      const popover = document.querySelector('.vendor-popover.show') as HTMLElement;
      if (!popover) return;
      const popRect = popover.getBoundingClientRect();
      this.vendorPopoverTop = rect.top - popRect.height - 6;
      this.vendorPopoverLeft = rect.left + rect.width / 2 - popRect.width / 2;
      if (this.vendorPopoverTop < 4) this.vendorPopoverTop = rect.bottom + 6;
      if (this.vendorPopoverLeft < 4) this.vendorPopoverLeft = 4;
    });
  }

  hideVendorPopover(): void {
    this.vendorPopoverRow = null;
  }

  vendorAddress(v: ExpenseRow['vendor']): string {
    if (!v) return '';
    return [v.addressLine1, v.addressLine2, v.barangay, v.city, v.province, v.postalCode, v.country]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  computeVatExclusive(row: ExpenseRow): number {
    return Number(row.withholdingTaxBase ?? (Number(row.amount || 0) - Number(row.receiptVatAmount ?? row.taxAmount ?? 0)));
  }

  onVendorSearchChange(value: string): void {
    if (this.isContextLocked) return;
    const query = String(value || '');
    this.vendorSearch.set(query);
    if (!query.trim()) {
      this.vendors.set([]);
      this.loadingVendors.set(false);
      return;
    }
    this.vendorSearchInput$.next(query);
  }

  onVendorSearchBlur(): void {
    setTimeout(() => this.vendorDropdownOpen.set(false), 160);
  }

  selectVendor(vendor: VendorOption): void {
    if (this.isContextLocked) return;
    this.selectedCreateVendor.set(vendor);
    this.createExpenseForm.patchValue({
      vendorId: vendor.id,
      vendorTaxId: vendor.taxId || '',
    });
    this.createExpenseForm.get('vendorId')?.markAsTouched();
    this.createExpenseForm.get('vendorId')?.updateValueAndValidity();
    this.vendors.set([]);
    this.vendorSearch.set(vendor.name || vendor.legalName || vendor.id);
  }

  clearSelectedVendor(): void {
    if (this.isContextLocked) return;
    this.selectedCreateVendor.set(null);
    this.createExpenseForm.patchValue({
      vendorId: '',
      vendorTaxId: '',
    });
    this.createExpenseForm.get('vendorId')?.markAsTouched();
    this.createExpenseForm.get('vendorId')?.updateValueAndValidity();
    this.vendorSearch.set('');
    this.vendors.set([]);
    this.vendorDropdownOpen.set(false);
  }

  openVendorCreateModal(): void {
    if (this.isContextLocked) return;
    this.vendorCreateError.set('');
    this.vendorCreateForm = this.newVendorCreateForm();
    this.isVendorCreateModalOpen.set(true);
  }

  closeVendorCreateModal(): void {
    if (this.isContextLocked) return;
    if (this.creatingVendor()) {
      return;
    }
    this.isVendorCreateModalOpen.set(false);
    this.vendorCreateError.set('');
  }

  createVendorFromModal(): void {
    if (this.isContextLocked) return;
    if (!this.currentOrganizationId) {
      this.vendorCreateError.set('Select a specific organization first.');
      return;
    }
    if (this.vendorCreateForm.invalid) {
      this.vendorCreateForm.markAllAsTouched();
      this.vendorCreateError.set('Please complete all required vendor fields.');
      return;
    }

    this.creatingVendor.set(true);
    this.vendorCreateError.set('');

    const payload = {
      ...this.vendorCreateForm.getRawValue(),
      contactEmail: String(this.vendorCreateForm.get('contactEmail')?.value || '').trim() || null,
      organizationId: this.currentOrganizationId,
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    };

    this.api.create<VendorOption>('/api/v1/vendors', payload).subscribe({
      next: (response) => {
        this.creatingVendor.set(false);
        const created = response.data;
        if (created?.id) {
          const createdVendorName =
            String(created.name || '').trim() ||
            String(this.vendorCreateForm.get('name')?.value || '').trim();
          this.selectVendor({
            id: created.id,
            name: createdVendorName,
            category: created.category,
            legalName: created.legalName,
            taxId: created.taxId,
            status: created.status,
          });
          this.closeVendorCreateModal();
          this.message.set('Vendor created and selected.');
        }
      },
      error: (err) => {
        this.creatingVendor.set(false);
        this.vendorCreateError.set(err?.error?.message || 'Unable to create vendor.');
      },
    });
  }

  onCreateFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.createFile = target?.files && target.files.length > 0 ? target.files[0] : null;
    this.createFileName.set(this.createFile?.name || '');
    const fileControl = this.createExpenseForm.get('file');
    if (this.createFile) {
      fileControl?.setValue(this.createFile.name);
      const isImage = this.createFile.type.startsWith('image/');
      const maxBytes = 5 * 1024 * 1024;
      if (!isImage) {
        fileControl?.setErrors({ invalidType: true });
      } else if (this.createFile.size > maxBytes) {
        fileControl?.setErrors({ tooLarge: true });
      } else {
        fileControl?.setErrors(null);
      }
    } else {
      fileControl?.setValue('');
      fileControl?.setErrors(null);
    }
    fileControl?.markAsTouched();
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  importExpensesCsv(): void {
    if (this.isContextLocked) {
      this.importModalError.set('Select a specific organization before importing expenses.');
      return;
    }
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing expenses.');
      return;
    }

    this.submitting.set(true);
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');
    this.importSummary.set(null);

    const formData = new FormData();
    formData.append('file', this.importFile);
    if (this.currentOrganizationId) {
      formData.append('organizationId', this.currentOrganizationId);
    }

    this.api.createFormData<Record<string, unknown>>('/api/v1/expenses/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        const data = (response.data || {}) as Record<string, unknown>;
        const imported = Number(data['imported'] || 0);
        const skipped = Number(data['skipped'] || 0);
        const totalRows = Number(data['totalRows'] || imported + skipped);
        const errors = Array.isArray(data['errors'])
          ? data['errors'].map((row) => String(row || '').trim()).filter((row) => row.length > 0)
          : [];
        this.importSummary.set({ imported, skipped, totalRows, errors });
        this.message.set(response.message || `Imported ${imported}, skipped ${skipped}.`);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import expenses.');
      },
    });
  }

  exportExpensesCsv(): void {
    if (this.isContextLocked) return;
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    if (this.searchQuery.trim()) params.set('q', this.searchQuery.trim());
    if (this.statusFilter) params.set('status', this.statusFilter);
    if (this.paymentMethodFilter) params.set('paymentMethod', this.paymentMethodFilter);
    if (this.expenseDateFrom) params.set('expenseDateFrom', this.expenseDateFrom);
    if (this.expenseDateTo) params.set('expenseDateTo', this.expenseDateTo);
    if (this.currentOrganizationId) params.set('organizationId', this.currentOrganizationId);

    this.api.download(`/api/v1/expenses/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Expenses CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export expenses.');
      },
    });
  }

  clearImportSummary(): void {
    this.importSummary.set(null);
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

  trackById(_index: number, row: ExpenseRow): string {
    return row.id;
  }

  controlHasError(controlName: string, errorCode?: string): boolean {
    const control = this.createExpenseForm.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
  }

  hasCreateFormError(errorCode: string): boolean {
    return !!this.createExpenseForm.errors?.[errorCode];
  }

  vendorCreateControlHasError(controlName: string, errorCode?: string): boolean {
    const control = this.vendorCreateForm.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
  }



  private newCreateExpenseForm(): FormGroup {
    return this.fb.group(
      {
        vendorId: ['', [Validators.required]],
        vendorTaxId: [''],
        expenseNumber: [''],
        vatExemptAmount: [0, [Validators.min(0)]],
        receiptVatAmount: [null, [Validators.min(0)]],
        withholdingTaxTypeId: [''],
        category: ['others', [Validators.required, Validators.maxLength(120)]],
        description: ['', [Validators.maxLength(2000)]],
        expenseDate: [new Date().toISOString().slice(0, 10), [Validators.required]],
        dueDate: [''],
        status: ['paid', [Validators.required]],
        paymentMethod: ['cash', [Validators.required]],
        amount: [0, [Validators.required, Validators.min(0.01)]],
        discountAmount: [0, [Validators.required, Validators.min(0)]],
        serviceCharge: [0, [Validators.min(0)]],
        notes: ['', [Validators.maxLength(2000)]],
        file: [''],
      },
      {
        validators: [this.expenseDateRangeValidator, this.vatExemptNotGreaterThanAmountValidator],
      }
    );
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

  private optionalEmailValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value || '').trim();
    if (!value) return null;
    return Validators.email(control);
  }

  private expenseDateRangeValidator(control: AbstractControl): ValidationErrors | null {
    const expenseDate = String(control.get('expenseDate')?.value || '').trim();
    const dueDate = String(control.get('dueDate')?.value || '').trim();
    if (!expenseDate || !dueDate) {
      return null;
    }
    if (new Date(dueDate).getTime() < new Date(expenseDate).getTime()) {
      return { invalidDateRange: true };
    }
    return null;
  }

  private vatExemptNotGreaterThanAmountValidator(control: AbstractControl): ValidationErrors | null {
    const amount = Number(control.get('amount')?.value ?? 0);
    const vatExemptAmount = Number(control.get('vatExemptAmount')?.value ?? 0);
    if (!Number.isFinite(amount) || !Number.isFinite(vatExemptAmount)) {
      return null;
    }
    if (vatExemptAmount > amount) {
      return { vatExemptTooHigh: true };
    }
    return null;
  }

  private newVendorCreateForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      category: ['others', [Validators.required]],
      legalName: ['', [Validators.maxLength(120)]],
      taxId: ['', [Validators.required, Validators.pattern(/^\d{3}-\d{3}-\d{3}-\d{5}$/)]],
      contactPerson: ['', [Validators.maxLength(120)]],
      contactEmail: ['', [this.optionalEmailValidator, Validators.maxLength(120)]],
      phone: ['', [Validators.maxLength(50)]],
      addressLine1: ['', [Validators.maxLength(255)]],
      addressLine2: ['', [Validators.maxLength(255)]],
      city: ['', [Validators.maxLength(120)]],
      state: ['', [Validators.maxLength(120)]],
      barangay: ['', [Validators.maxLength(120)]],
      province: ['', [Validators.maxLength(120)]],
      postalCode: ['', [Validators.maxLength(50)]],
      country: [getBrowserCountry(), [Validators.maxLength(100)]],
      paymentTerms: ['', [Validators.maxLength(120)]],
      status: ['active', [Validators.required]],
      notes: ['', [Validators.maxLength(2000)]],
    });
  }

  onVendorTaxIdInput(value: string): void {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    const parts = [
      digits.slice(0, 3),
      digits.slice(3, 6),
      digits.slice(6, 9),
      digits.slice(9, 14),
    ].filter((part) => part.length > 0);
    const masked = parts.join('-');

    this.vendorCreateForm.patchValue({ taxId: masked }, { emitEvent: false });
    this.vendorCreateForm.get('taxId')?.markAsTouched();
    this.vendorCreateForm.get('taxId')?.updateValueAndValidity();
  }

  private setupExpenseAutoCompute(): void {
    this.expenseComputeSub?.unsubscribe();
    this.recomputeExpenseBreakdown();
    this.expenseComputeSub = this.createExpenseForm.valueChanges.subscribe(() => {
      this.recomputeExpenseBreakdown();
    });
  }

  private recomputeExpenseBreakdown(): void {
    this.calculationError = '';
    const selectedId = String(this.createExpenseForm.get('withholdingTaxTypeId')?.value || '').trim();
    const withholding = this.withholdingTaxTypes().find((type) => type.id === selectedId);
    if (selectedId && !withholding && !this.taxContextLoading) {
      this.calculationError = 'Selected withholding tax is unavailable. Choose an active type or None.';
      return;
    }
    try {
      const computed = computeExpenseAmounts({
        ...this.createExpenseForm.getRawValue(),
        taxType: { code: this.organizationTaxTypeCode, name: this.organizationTaxTypeName, percentage: this.organizationTaxRate },
        withholdingPercentage: withholding?.percentage || 0,
        withholdingMinimumBaseAmount: withholding?.minimumBaseAmount || 0,
      });
      this.computedReceiptVatAmount = computed.receiptVatAmount;
      this.computedWithholdingBase = computed.withholdingTaxBase;
      this.computedVatExclusive = computed.withholdingTaxBase;
      this.computedVatableInclusive = computed.amount - computed.vatExemptAmount;
      this.computedTaxableAmount = computed.taxableAmount;
      this.computedTaxAmount = computed.taxAmount;
      this.computedWithholdingTaxAmount = computed.withHoldingTaxAmount;
      this.computedTotalAmount = computed.totalAmount;
    } catch (err) {
      this.calculationError = err instanceof Error ? err.message : 'Check the receipt amounts.';
    }
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      organizationId: this.optionalString(form['organizationId']),
      vendorId: this.optionalString(form['vendorId']),
      vendorTaxId: this.optionalString(form['vendorTaxId']),
      expenseNumber: this.optionalString(form['expenseNumber']),
      vatExemptAmount: this.optionalNumber(form['vatExemptAmount']),
      receiptVatAmount: this.computedReceiptVatAmount,
      taxableAmount: this.computedTaxableAmount,
      taxAmount: this.computedTaxAmount,
      withHoldingTaxAmount: this.computedWithholdingTaxAmount,
      totalAmount: this.computedTotalAmount,
      withholdingTaxTypeId: String(form['withholdingTaxTypeId'] || '').trim(),
      category: this.optionalString(form['category']),
      description: this.optionalString(form['description']),
      expenseDate: this.optionalString(form['expenseDate']),
      dueDate: this.optionalString(form['dueDate']),
      status: this.optionalString(form['status']),
      paymentMethod: this.optionalString(form['paymentMethod']),
      amount: this.optionalNumber(form['amount']),
      discountAmount: this.optionalNumber(form['discountAmount']),
      serviceCharge: this.optionalNumber(form['serviceCharge']),
      notes: this.optionalString(form['notes']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };
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
