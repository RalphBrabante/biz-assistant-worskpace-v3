import { getBrowserCountry } from '../../shared/countries';
import { ModalDirective } from '../../shared/modal.directive';
import { DropdownDirective } from '../../shared/dropdown.directive';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { CustomerFormFieldsComponent } from './forms/customer-form-fields.component';

interface CustomerRow {
  id: string;
  organizationId: string;
  customerCode?: string;
  type?: string;
  name: string;
  legalName?: string;
  taxId: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  creditLimit?: number;
  paymentTermsDays?: number;
  status?: string;
  notes?: string;
  isActive?: boolean;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
}

@Component({
  selector: 'app-customers-page',
  standalone: true,
  imports: [ModalDirective, DropdownDirective, OrganizationRequiredComponent, CommonModule, FormsModule, ReactiveFormsModule, TooltipDirective, CustomerFormFieldsComponent],
  templateUrl: './customers-page.component.html',
})
export class CustomersPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<CustomerRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly isImportModalOpen = signal(false);
  readonly exporting = signal(false);
  readonly importModalError = signal('');
  readonly createModalError = signal('');
  readonly editModalError = signal('');
  private readonly createFieldLabels: Record<string, string> = {
    customerCode: 'Customer Code',
    type: 'Type',
    name: 'Name',
    legalName: 'Legal Name',
    taxId: 'Tax ID',
    contactPerson: 'Contact Person',
    email: 'Email',
    phone: 'Phone',
    mobile: 'Mobile',
    addressLine1: 'Address Line 1',
    addressLine2: 'Address Line 2',
    city: 'City',
    state: 'State',
    postalCode: 'Postal Code',
    country: 'Country',
    creditLimit: 'Credit Limit',
    paymentTermsDays: 'Payment Terms',
    status: 'Status',
    notes: 'Notes',
  };

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  readonly pageSizeOptions = [10, 20, 50, 100];
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'customers-page';

  createCustomerForm: FormGroup = this.newCustomerFormGroup();
  editCustomerForm: FormGroup = this.newCustomerFormGroup();
  editingId = '';
  private importFile: File | null = null;

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.name || '').toLowerCase().includes(q) ||
        String(row.legalName || '').toLowerCase().includes(q) ||
        String(row.taxId || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.customerCode || '').toLowerCase().includes(q) ||
        String(row.organization?.name || '').toLowerCase().includes(q)
      );
    });
  });

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
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


  ngOnInit(): void {
    this.restoreTablePreferences();
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
    const q = this.filter().trim();
    const params = new URLSearchParams({
      page: String(this.page),
      limit: String(this.pageSize),
    });
    if (q) {
      params.set('q', q);
    }

    this.api.list<CustomerRow>(`/api/v1/customers?${params.toString()}`).subscribe({
      next: (response: ApiResponse<CustomerRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load customers.');
      },
    });
  }

  openCreateModal(): void {
    if (this.isContextLocked) return;
    this.createCustomerForm = this.newCustomerFormGroup();
    this.error.set('');
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.createModalError.set('');
    this.isCreateModalOpen.set(false);
  }

  openImportModal(): void {
    if (this.isContextLocked) return;
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

  createCustomer(): void {
    if (this.isContextLocked) {
      this.createModalError.set('Select a specific organization before creating a customer.');
      return;
    }
    if (!this.currentOrganizationId.trim()) {
      if (this.organizationContext.isAllOrganizationsSelected()) {
        this.createModalError.set('Select a specific organization before creating a customer.');
        return;
      }
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }

    if (this.createCustomerForm.invalid) {
      this.createCustomerForm.markAllAsTouched();
      this.createModalError.set('Please complete all required customer fields.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.message.set('');

    const currentUser = this.auth.currentUser();
    const payload = this.buildPayload({
      ...this.createCustomerForm.getRawValue(),
      organizationId: this.currentOrganizationId,
      createdBy: currentUser?.id || '',
      updatedBy: currentUser?.id || '',
    });

    this.api.create<CustomerRow>('/api/v1/customers', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Customer created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create customer.');
      },
    });
  }

  getCreateControl(controlName: string): AbstractControl | null {
    return this.createCustomerForm.get(controlName);
  }

  isCreateFieldRequired(controlName: string): boolean {
    const control = this.getCreateControl(controlName);
    if (!control || typeof control.hasValidator !== 'function') {
      return false;
    }
    return control.hasValidator(Validators.required);
  }

  shouldShowCreateFieldError(controlName: string): boolean {
    const control = this.getCreateControl(controlName);
    if (!control) {
      return false;
    }
    return control.invalid && (control.touched || control.dirty);
  }

  getCreateFieldError(controlName: string): string {
    const control = this.getCreateControl(controlName);
    if (!control || !this.shouldShowCreateFieldError(controlName)) {
      return '';
    }
    const label = this.createFieldLabels[controlName] || 'This field';
    if (control.hasError('required')) {
      return `${label} is required.`;
    }
    if (control.hasError('email')) {
      return 'Enter a valid email address.';
    }
    if (control.hasError('maxlength')) {
      const requiredLength = control.getError('maxlength')?.requiredLength;
      return `${label} must be at most ${requiredLength} characters.`;
    }
    if (control.hasError('min')) {
      return `${label} must be 0 or greater.`;
    }
    return `${label} is invalid.`;
  }

  getEditControl(controlName: string): AbstractControl | null {
    return this.editCustomerForm.get(controlName);
  }

  isEditFieldRequired(controlName: string): boolean {
    const control = this.getEditControl(controlName);
    if (!control || typeof control.hasValidator !== 'function') {
      return false;
    }
    return control.hasValidator(Validators.required);
  }

  shouldShowEditFieldError(controlName: string): boolean {
    const control = this.getEditControl(controlName);
    if (!control) {
      return false;
    }
    return control.invalid && (control.touched || control.dirty);
  }

  getEditFieldError(controlName: string): string {
    const control = this.getEditControl(controlName);
    if (!control || !this.shouldShowEditFieldError(controlName)) {
      return '';
    }
    const label = this.createFieldLabels[controlName] || 'This field';
    if (control.hasError('required')) {
      return `${label} is required.`;
    }
    if (control.hasError('email')) {
      return 'Enter a valid email address.';
    }
    if (control.hasError('maxlength')) {
      const requiredLength = control.getError('maxlength')?.requiredLength;
      return `${label} must be at most ${requiredLength} characters.`;
    }
    if (control.hasError('min')) {
      return `${label} must be 0 or greater.`;
    }
    return `${label} is invalid.`;
  }

  onCreateTaxIdInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const masked = this.formatTaxId(input.value);
    if (input.value !== masked) {
      input.value = masked;
    }
    this.createCustomerForm.patchValue({ taxId: masked }, { emitEvent: false });
  }

  onEditTaxIdInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const masked = this.formatTaxId(input.value);
    if (input.value !== masked) {
      input.value = masked;
    }
    this.editCustomerForm.patchValue({ taxId: masked }, { emitEvent: false });
  }

  openEditModal(row: CustomerRow): void {
    if (this.isContextLocked) return;
    this.editingId = row.id;
    this.editCustomerForm = this.newCustomerFormGroup({
      organizationId: row.organizationId || '',
      customerCode: row.customerCode || '',
      type: row.type || 'business',
      name: row.name || '',
      legalName: row.legalName || '',
      taxId: this.formatTaxId(row.taxId || ''),
      contactPerson: row.contactPerson || '',
      email: row.email || '',
      phone: row.phone || '',
      mobile: row.mobile || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postalCode || '',
      country: row.country || getBrowserCountry(),
      creditLimit: row.creditLimit ?? 0,
      paymentTermsDays: row.paymentTermsDays ?? 30,
      status: row.status || 'active',
      notes: row.notes || '',
      isActive: row.isActive !== false,
    });
    this.editModalError.set('');
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.editingId = '';
    this.editCustomerForm = this.newCustomerFormGroup();
    this.editModalError.set('');
    this.isEditModalOpen.set(false);
  }

  async saveEdit(): Promise<void> {
    if (this.isContextLocked) {
      this.editModalError.set('Select a specific organization before updating customers.');
      return;
    }
    if (!this.editingId) {
      return;
    }
    if (this.editCustomerForm.invalid) {
      this.editCustomerForm.markAllAsTouched();
      this.editModalError.set('Please complete all required customer fields.');
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Customer',
      message: 'Save changes to this customer?',
      confirmText: 'Update Customer',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.editModalError.set('');
    this.message.set('');

    const currentUser = this.auth.currentUser();
    const payload = this.buildPayload({
      ...this.editCustomerForm.getRawValue(),
      updatedBy: currentUser?.id || '',
    });

    this.api.update<CustomerRow>('/api/v1/customers', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Customer updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.editModalError.set(err?.error?.message || 'Unable to update customer.');
      },
    });
  }

  async removeCustomer(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Customer',
      message: 'Delete this customer? This action cannot be undone.',
      confirmText: 'Delete Customer',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-person-vcard',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/customers', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Customer deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete customer.');
      },
    });
  }

  exportCustomersCsv(): void {
    if (this.isContextLocked) return;
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

    this.api.download(`/api/v1/customers/export?${params.toString()}`).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.message.set('Customers CSV exported successfully.');
      },
      error: (err) => {
        this.exporting.set(false);
        this.error.set(err?.error?.message || 'Unable to export customers.');
      },
    });
  }

  importCustomersCsv(): void {
    if (this.isContextLocked) {
      this.importModalError.set('Select a specific organization before importing customers.');
      return;
    }
    if (!this.importFile) {
      this.importModalError.set('Please select a CSV file to import.');
      return;
    }
    if (this.organizationContext.isAllOrganizationsSelected()) {
      this.importModalError.set('Select a specific organization before importing customers.');
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

    this.api.createFormData('/api/v1/customers/import', formData).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.closeImportModal();
        this.message.set(response.message || 'Customers imported successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.importModalError.set(err?.error?.message || 'Unable to import customers.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
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
    this.filter.set('');
  }

  onFilterChange(value: string): void {
    if (this.isContextLocked) return;
    this.filter.set(value);
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

  trackById(_index: number, row: CustomerRow): string {
    return row.id;
  }

  organizationLabel(row: CustomerRow): string {
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  customerStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return 'ui-badge-success';
      case 'inactive':
        return 'ui-badge-secondary';
      case 'blocked':
      case 'blacklisted':
        return 'ui-badge-danger';
      default:
        return 'ui-badge-secondary';
    }
  }

  customerActiveBadgeClass(isActive: unknown): string {
    return isActive === false ? 'ui-badge-secondary' : 'ui-badge-success';
  }

  private newCustomerForm(): Record<string, unknown> {
    return {
      organizationId: '',
      customerCode: '',
      type: 'business',
      name: '',
      legalName: '',
      taxId: '',
      contactPerson: '',
      email: '',
      phone: '',
      mobile: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: getBrowserCountry(),
      creditLimit: 0,
      paymentTermsDays: 30,
      status: 'active',
      notes: '',
      isActive: true,
      createdBy: '',
      updatedBy: '',
    };
  }

  private newCustomerFormGroup(initialValues: Partial<Record<string, unknown>> = {}): FormGroup {
    const defaults = { ...this.newCustomerForm(), ...initialValues };
    return this.fb.group({
      organizationId: [defaults['organizationId']],
      customerCode: [defaults['customerCode'], [Validators.maxLength(120)]],
      type: [defaults['type'], [Validators.required]],
      name: [defaults['name'], [Validators.required, Validators.maxLength(180)]],
      legalName: [defaults['legalName'], [Validators.maxLength(180)]],
      taxId: [defaults['taxId'], [Validators.required, Validators.maxLength(120)]],
      contactPerson: [defaults['contactPerson'], [Validators.maxLength(120)]],
      email: [defaults['email'], [Validators.email]],
      phone: [defaults['phone'], [Validators.maxLength(40)]],
      mobile: [defaults['mobile'], [Validators.maxLength(40)]],
      addressLine1: [defaults['addressLine1'], [Validators.maxLength(255)]],
      addressLine2: [defaults['addressLine2'], [Validators.maxLength(255)]],
      city: [defaults['city'], [Validators.maxLength(120)]],
      state: [defaults['state'], [Validators.maxLength(120)]],
      postalCode: [defaults['postalCode'], [Validators.maxLength(20)]],
      country: [defaults['country']],
      creditLimit: [defaults['creditLimit'], [Validators.min(0)]],
      paymentTermsDays: [defaults['paymentTermsDays'], [Validators.min(0)]],
      status: [defaults['status'], [Validators.required]],
      notes: [defaults['notes'], [Validators.maxLength(2000)]],
      isActive: [defaults['isActive']],
    });
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      customerCode: this.optionalString(form['customerCode']),
      type: this.optionalString(form['type']),
      name: this.asString(form['name']),
      legalName: this.optionalString(form['legalName']),
      taxId: this.asString(form['taxId']),
      contactPerson: this.optionalString(form['contactPerson']),
      email: this.optionalString(form['email']),
      phone: this.optionalString(form['phone']),
      mobile: this.optionalString(form['mobile']),
      addressLine1: this.optionalString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.optionalString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      creditLimit: this.optionalNumber(form['creditLimit']),
      paymentTermsDays: this.optionalNumber(form['paymentTermsDays']),
      status: this.optionalString(form['status']),
      notes: this.optionalString(form['notes']),
      isActive: Boolean(form['isActive']),
      createdBy: this.optionalString(form['createdBy']),
      updatedBy: this.optionalString(form['updatedBy']),
    };

    const organizationId = this.asString(form['organizationId']);
    if (organizationId) {
      payload['organizationId'] = organizationId;
    }

    return payload;
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

  private formatTaxId(raw: unknown): string {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 14);
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 14);
    return [p1, p2, p3, p4].filter(Boolean).join('-');
  }
}
