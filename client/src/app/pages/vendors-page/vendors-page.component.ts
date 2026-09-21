import { ModalDirective } from '../../shared/modal.directive';
import { DropdownDirective } from '../../shared/dropdown.directive';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { VendorFormFieldsComponent } from './forms/vendor-form-fields.component';

interface VendorRow {
  id: string;
  organizationId: string;
  organizations?: OrganizationOption[];
  name: string;
  category?: string;
  legalName?: string;
  taxId?: string;
  contactPerson?: string;
  contactEmail?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  barangay?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  paymentTerms?: string;
  notes?: string;
  status?: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

@Component({
  selector: 'app-vendors-page',
  standalone: true,
  imports: [ModalDirective, DropdownDirective, OrganizationRequiredComponent, CommonModule, FormsModule, ReactiveFormsModule, TooltipDirective, VendorFormFieldsComponent],
  templateUrl: './vendors-page.component.html',
})
export class VendorsPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<VendorRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);
  readonly importModalError = signal('');
  readonly vendorModalError = signal('');
  readonly countryOptions = this.buildCountryOptions();
  readonly organizations = signal<OrganizationOption[]>([]);

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  readonly pageSizeOptions = [10, 20, 50, 100];

  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'vendors-page';

  vendorModalMode: 'create' | 'edit' = 'create';
  vendorFormSubmitted = false;
  vendorForm: FormGroup = this.newVendorFormGroup();
  editingId = '';
  vendorOwnerOrganizationId = '';
  private importFile: File | null = null;

  get currentUserId(): string {
    return this.auth.currentUser()?.id || '';
  }

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get isContextLocked(): boolean {
    return this.isSuperuser && !this.currentOrganizationId;
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.loadOrganizations();
    this.load();
  }

  loadOrganizations(): void {
    if (!this.isSuperuser) {
      this.organizations.set([]);
      return;
    }
    this.api.list<OrganizationOption>('/api/v1/organizations?limit=500&isActive=true').subscribe({
      next: (response) => {
        this.organizations.set(response.data || []);
      },
      error: () => {
        this.organizations.set([]);
      },
    });
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

    const q = this.filter().trim();
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    if (q) {
      params.set('q', q);
    }

    this.api.list<VendorRow>(`/api/v1/vendors?${params.toString()}`).subscribe({
      next: (response: ApiResponse<VendorRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load vendors.');
      },
    });
  }

  openCreateModal(): void {
    if (this.isContextLocked) {
      return;
    }
    this.vendorModalMode = 'create';
    this.vendorOwnerOrganizationId = this.currentOrganizationId;
    this.vendorForm = this.newVendorFormGroup({
      organizationIds: this.currentOrganizationId ? [this.currentOrganizationId] : [],
    });
    this.vendorFormSubmitted = false;
    this.editingId = '';
    this.error.set('');
    this.vendorModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
    this.vendorFormSubmitted = false;
    this.vendorModalError.set('');
  }

  openImportModal(): void {
    if (this.isContextLocked) {
      return;
    }
    this.importFile = null;
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');
    this.isImportModalOpen.set(true);
  }

  closeImportModal(): void {
    this.isImportModalOpen.set(false);
    this.importFile = null;
    this.importModalError.set('');
  }

  onImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.importFile = target?.files && target.files.length > 0 ? target.files[0] : null;
  }

  createVendor(): void {
    if (this.isContextLocked) {
      this.vendorModalError.set('Select a specific organization before creating a vendor.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.vendorModalError.set('Select a specific organization before creating a vendor.');
      return;
    }

    this.normalizeVendorName();
    this.vendorFormSubmitted = true;
    if (this.vendorForm.invalid) {
      this.vendorForm.markAllAsTouched();
      this.vendorModalError.set('Please complete all required vendor fields.');
      return;
    }

    this.submitting.set(true);
    this.vendorModalError.set('');
    this.message.set('');

    const payload = this.buildVendorMutationPayload({
      ...this.vendorForm.getRawValue(),
      createdBy: this.currentUserId,
      updatedBy: this.currentUserId,
    });

    this.api.create<VendorRow>('/api/v1/vendors', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Vendor created successfully.');
        this.page = 1;
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.vendorModalError.set(err?.error?.message || 'Unable to create vendor.');
      },
    });
  }

  openEditModal(row: VendorRow): void {
    if (this.isContextLocked) {
      return;
    }
    this.vendorModalMode = 'edit';
    this.editingId = row.id;
    this.vendorOwnerOrganizationId = row.organizationId || '';
    this.vendorForm = this.newVendorFormGroup({
      name: row.name || '',
      category: row.category || 'others',
      legalName: row.legalName || '',
      taxId: row.taxId || '',
      contactPerson: row.contactPerson || '',
      contactEmail: row.contactEmail || '',
      phone: row.phone || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      barangay: row.barangay || '',
      province: row.province || '',
      postalCode: row.postalCode || '',
      country: row.country || 'United States',
      paymentTerms: row.paymentTerms || '',
      notes: row.notes || '',
      status: row.status || 'active',
      organizationIds: this.vendorAssignedOrganizationIds(row),
    });
    this.vendorFormSubmitted = false;
    this.error.set('');
    this.vendorModalError.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.vendorOwnerOrganizationId = '';
    this.isEditModalOpen.set(false);
    this.vendorFormSubmitted = false;
    this.vendorModalError.set('');
  }

  async saveEdit(): Promise<void> {
    if (this.isContextLocked) {
      this.vendorModalError.set('Select a specific organization before updating vendors.');
      return;
    }
    if (!this.editingId) {
      return;
    }
    this.normalizeVendorName();
    this.vendorFormSubmitted = true;
    if (this.vendorForm.invalid) {
      this.vendorForm.markAllAsTouched();
      this.vendorModalError.set('Please complete all required vendor fields.');
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Vendor',
      message: 'Save changes to this vendor?',
      confirmText: 'Update Vendor',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.vendorModalError.set('');
    this.message.set('');

    const payload = this.buildVendorMutationPayload({
      ...this.vendorForm.getRawValue(),
      updatedBy: this.currentUserId,
    });

    this.api.update<VendorRow>('/api/v1/vendors', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Vendor updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.vendorModalError.set(err?.error?.message || 'Unable to update vendor.');
      },
    });
  }

  async removeVendor(id: string): Promise<void> {
    if (this.isContextLocked) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Vendor',
      message: 'Delete this vendor? This action cannot be undone.',
      confirmText: 'Delete Vendor',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-truck',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/vendors', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Vendor deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete vendor.');
      },
    });
  }

  exportVendorsCsv(): void {
    if (this.isContextLocked) {
      return;
    }
    this.exporting.set(true);
    this.error.set('');
    this.message.set('');

    const params = new URLSearchParams();
    const q = this.filter().trim();
    if (q) {
      params.set('q', q);
    }
    if (this.currentOrganizationId) {
      params.set('organizationId', this.currentOrganizationId);
    }

    this.api.download(`/api/v1/vendors/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vendors-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Vendors CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export vendors.');
      },
    });
  }

  importVendorsCsv(): void {
    if (this.isContextLocked) {
      this.importModalError.set('Select a specific organization before importing vendors.');
      return;
    }
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing vendors.');
      return;
    }

    this.submitting.set(true);
    this.importModalError.set('');
    this.error.set('');
    this.message.set('');

    const formData = new FormData();
    formData.append('file', this.importFile);
    if (this.currentOrganizationId) {
      formData.append('organizationId', this.currentOrganizationId);
    }

    this.api.createFormData('/api/v1/vendors/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        this.message.set(response.message || 'Vendors imported successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import vendors.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) {
      return;
    }
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  get hasActiveFilters(): boolean {
    return !!this.filter().trim();
  }

  get activeFilterCount(): number {
    return this.filter().trim() ? 1 : 0;
  }

  clearFilters(): void {
    if (this.isContextLocked) return;
    this.filter.set('');
  }

  onFilterChange(value: string): void {
    if (this.isContextLocked) {
      return;
    }
    this.filter.set(value);
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onPageSizeChange(value: string): void {
    if (this.isContextLocked) {
      return;
    }
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

  trackById(_index: number, row: VendorRow): string {
    return row.id;
  }

  organizationLabel(row: VendorRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  assignedOrganizationsLabel(row: VendorRow): string {
    const labels = (row.organizations || [])
      .map((organization) => this.organizationOptionLabel(organization))
      .filter(Boolean);
    if (labels.length === 0) {
      return this.organizationLabel(row);
    }
    return Array.from(new Set(labels)).join(', ');
  }

  statusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return 'ui-badge-success';
      case 'inactive':
      case 'suspended':
        return 'ui-badge-secondary';
      case 'blacklisted':
        return 'ui-badge-danger';
      default:
        return 'ui-badge-secondary';
    }
  }

  private newVendorForm(): Record<string, unknown> {
    return {
      name: '',
      category: 'others',
      legalName: '',
      taxId: '',
      contactPerson: '',
      contactEmail: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      barangay: '',
      province: '',
      postalCode: '',
      country: 'United States',
      paymentTerms: '',
      notes: '',
      status: 'active',
      organizationIds: [],
      createdBy: '',
      updatedBy: '',
    };
  }

  private newVendorFormGroup(initial: Partial<Record<string, unknown>> = {}): FormGroup {
    const defaults = { ...this.newVendorForm(), ...initial };
    const maskedTaxId = this.formatTaxId(defaults['taxId']);
    return this.fb.group({
      name: [defaults['name'], [Validators.required, Validators.maxLength(180)]],
      category: [defaults['category'], [Validators.required]],
      legalName: [defaults['legalName'], [Validators.maxLength(200)]],
      taxId: [maskedTaxId, [Validators.maxLength(64)]],
      contactPerson: [defaults['contactPerson'], [Validators.maxLength(150)]],
      contactEmail: [defaults['contactEmail'], [this.optionalEmailValidator]],
      phone: [defaults['phone'], [Validators.maxLength(50)]],
      addressLine1: [defaults['addressLine1'], [Validators.maxLength(255)]],
      addressLine2: [defaults['addressLine2'], [Validators.maxLength(255)]],
      city: [defaults['city'], [Validators.maxLength(100)]],
      state: [defaults['state'], [Validators.maxLength(100)]],
      barangay: [defaults['barangay'], [Validators.maxLength(120)]],
      province: [defaults['province'], [Validators.maxLength(120)]],
      postalCode: [defaults['postalCode'], [Validators.maxLength(20)]],
      country: [defaults['country'], [Validators.maxLength(100)]],
      paymentTerms: [defaults['paymentTerms'], [Validators.maxLength(120)]],
      notes: [defaults['notes']],
      status: [defaults['status'], [Validators.required]],
      organizationIds: [Array.isArray(defaults['organizationIds']) ? defaults['organizationIds'] : []],
    });
  }

  onVendorTaxIdInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const masked = this.formatTaxId(input.value);
    if (input.value !== masked) {
      input.value = masked;
    }
    this.vendorForm.patchValue({ taxId: masked }, { emitEvent: false });
  }

  onVendorFormInput(): void {
    if (!this.vendorModalError()) {
      return;
    }
    this.vendorModalError.set('');
  }

  private optionalEmailValidator(control: AbstractControl): ValidationErrors | null {
    const value = String(control.value || '').trim();
    if (!value) return null;
    return Validators.email(control);
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      name: this.optionalString(form['name']),
      category: this.optionalString(form['category']),
      legalName: this.optionalString(form['legalName']),
      taxId: this.optionalString(form['taxId']),
      contactPerson: this.optionalString(form['contactPerson']),
      contactEmail: this.optionalString(form['contactEmail']) ?? null,
      phone: this.optionalString(form['phone']),
      addressLine1: this.optionalString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.optionalString(form['city']),
      state: this.optionalString(form['state']),
      barangay: this.optionalString(form['barangay']),
      province: this.optionalString(form['province']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      paymentTerms: this.optionalString(form['paymentTerms']),
      notes: this.optionalString(form['notes']),
      status: this.optionalString(form['status']),
      organizationIds: Array.isArray(form['organizationIds']) ? form['organizationIds'] : undefined,
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };
  }

  private buildVendorMutationPayload(form: Record<string, unknown>): Record<string, unknown> {
    const payload = this.buildPayload(form);
    if (this.isSuperuser && this.currentOrganizationId) {
      payload['organizationId'] = this.currentOrganizationId;
    }
    return payload;
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  private vendorAssignedOrganizationIds(row: VendorRow): string[] {
    const ids = (row.organizations || [])
      .map((organization) => organization.id)
      .filter(Boolean);
    if (row.organizationId && !ids.includes(row.organizationId)) {
      ids.unshift(row.organizationId);
    }
    return ids;
  }

  private optionalString(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }

  private formatTaxId(raw: unknown): string {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 14);
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 14);
    return [p1, p2, p3, p4].filter(Boolean).join('-');
  }

  private normalizeVendorName(): void {
    const control = this.vendorForm.get('name');
    if (!control) {
      return;
    }
    const normalized = String(control.value || '').replace(/\s+/g, ' ').trim();
    control.setValue(normalized, { emitEvent: false });
    control.updateValueAndValidity({ emitEvent: false });
  }

  private buildCountryOptions(): string[] {
    const fallback = ['United States'];
    try {
      const intlAny = Intl as unknown as {
        DisplayNames?: new (locales: string[], options: { type: 'region' }) => Intl.DisplayNames;
      };
      if (!intlAny.DisplayNames) {
        return fallback;
      }
      const regionNames = new intlAny.DisplayNames(['en'], { type: 'region' });
      const names = new Set<string>();
      for (let first = 65; first <= 90; first += 1) {
        for (let second = 65; second <= 90; second += 1) {
          const code = String.fromCharCode(first, second);
          const value = regionNames.of(code);
          if (!value || value === code || /unknown region/i.test(value)) {
            continue;
          }
          names.add(value);
        }
      }
      const result = Array.from(names).sort((a, b) => a.localeCompare(b));
      return result.length > 0 ? result : fallback;
    } catch (_err) {
      return fallback;
    }
  }
}
