import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { OrganizationFormFieldsComponent } from './forms/organization-form-fields.component';

interface OrganizationRow {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  currency?: string;
  taxTypeId?: string;
  taxpayerClassification?: string;
  deductionMethod?: string;
  incomeTaxRate?: number;
  isIncomeTaxExempt?: boolean;
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  website?: string;
  industry?: string;
  employeeCount?: number;
  notes?: string;
  isActive?: boolean;
}

interface TaxTypeOption {
  id: string;
  code: string;
  name: string;
  percentage: number;
  isActive?: boolean;
}

interface CurrencyOption {
  code: string;
  label: string;
}

@Component({
  selector: 'app-organizations-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective, OrganizationFormFieldsComponent],
  templateUrl: './organizations-page.component.html',
})
export class OrganizationsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly fb = inject(FormBuilder);

  readonly rows = signal<OrganizationRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly isEditModalOpen = signal(false);
  readonly taxTypes = signal<TaxTypeOption[]>([]);
  readonly createModalError = signal('');
  readonly editModalError = signal('');
  readonly countryOptions = this.buildCountryOptions();
  readonly currencyOptions = this.buildCurrencyOptions();
  private readonly createFieldLabels: Record<string, string> = {
    name: 'Name',
    legalName: 'Legal Name',
    taxId: 'Tax ID',
    addressLine1: 'Address Line 1',
    addressLine2: 'Address Line 2',
    city: 'City',
    state: 'State',
    postalCode: 'Postal Code',
    country: 'Country',
    currency: 'Currency',
    taxTypeId: 'Tax Type',
    taxpayerClassification: 'Taxpayer Classification',
    deductionMethod: 'Deduction Method',
    incomeTaxRate: 'Income Tax Rate',
    contactName: 'Contact Name',
    contactEmail: 'Contact Email',
    phone: 'Phone',
    website: 'Website',
    industry: 'Industry',
    employeeCount: 'Employee Count',
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
  private readonly tablePrefsKey = 'organizations-page';

  createOrganizationForm: FormGroup = this.newOrganizationFormGroup();
  editOrganizationForm: FormGroup = this.newOrganizationFormGroup();
  editingId = '';

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.name || '').toLowerCase().includes(q) ||
        String(row.legalName || '').toLowerCase().includes(q) ||
        String(row.contactEmail || '').toLowerCase().includes(q) ||
        String(row.city || '').toLowerCase().includes(q)
      );
    });
  });

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.loadTaxTypes();
    this.load();
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get currentUserCountry(): string {
    return String(this.auth.currentUser()?.country || '').trim() || 'United States';
  }

  load(): void {
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

    this.api.list<OrganizationRow>(`/api/v1/organizations?${params.toString()}`).subscribe({
      next: (response: ApiResponse<OrganizationRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load organizations.');
      },
    });
  }

  openCreateModal(): void {
    this.createOrganizationForm = this.newOrganizationFormGroup();
    this.loadTaxTypes();
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
    this.createModalError.set('');
  }

  createOrganization(): void {
    if (this.createOrganizationForm.invalid) {
      this.createOrganizationForm.markAllAsTouched();
      this.createModalError.set('Please complete all required organization fields.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.message.set('');

    const payload = this.buildPayload(this.createOrganizationForm.getRawValue());

    this.api.create<OrganizationRow>('/api/v1/organizations', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Organization created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create organization.');
      },
    });
  }

  getCreateControl(controlName: string): AbstractControl | null {
    return this.createOrganizationForm.get(controlName);
  }

  getEditControl(controlName: string): AbstractControl | null {
    return this.editOrganizationForm.get(controlName);
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

  startEdit(row: OrganizationRow): void {
    this.loadTaxTypes();
    this.editingId = row.id;
    this.editOrganizationForm = this.newOrganizationFormGroup({
      name: row.name || '',
      legalName: row.legalName || '',
      taxId: row.taxId || '',
      addressLine1: row.addressLine1 || '',
      addressLine2: row.addressLine2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postalCode || '',
      country: row.country || this.currentUserCountry,
      currency: row.currency || this.currentOrganizationCurrency,
      taxTypeId: row.taxTypeId || row.taxType?.id || '',
      taxpayerClassification: row.taxpayerClassification || '',
      deductionMethod: row.deductionMethod || 'itemized',
      incomeTaxRate: row.incomeTaxRate ?? null,
      isIncomeTaxExempt: row.isIncomeTaxExempt === true,
      contactName: row.contactName || '',
      contactEmail: row.contactEmail || '',
      phone: row.phone || '',
      website: row.website || '',
      industry: row.industry || '',
      employeeCount: row.employeeCount ?? 0,
      notes: row.notes || '',
      isActive: row.isActive !== false,
    });
    this.editModalError.set('');
    this.error.set('');
    this.message.set('');
    this.isEditModalOpen.set(true);
  }

  closeEditModal(): void {
    this.isEditModalOpen.set(false);
    this.editModalError.set('');
    this.editingId = '';
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) {
      return;
    }
    if (this.editOrganizationForm.invalid) {
      this.editOrganizationForm.markAllAsTouched();
      this.editModalError.set('Please complete all required organization fields.');
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Organization',
      message: 'Save changes to this organization?',
      confirmText: 'Update Organization',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.editModalError.set('');
    this.message.set('');

    const payload = this.buildPayload(this.editOrganizationForm.getRawValue());

    this.api.update<OrganizationRow>('/api/v1/organizations', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Organization updated successfully.');
        this.closeEditModal();
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.editModalError.set(err?.error?.message || 'Unable to update organization.');
      },
    });
  }

  async removeOrganization(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Organization',
      message: 'Delete this organization? This action cannot be undone.',
      confirmText: 'Delete Organization',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-buildings',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/organizations', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Organization deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete organization.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading()) {
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

  trackById(_index: number, row: OrganizationRow): string {
    return row.id;
  }

  taxTypeLabel(row: OrganizationRow): string {
    if (row.taxType?.name) {
      return row.taxType.name;
    }
    if (row.taxType?.code) {
      return row.taxType.code;
    }
    if (!row.taxTypeId) {
      return '-';
    }
    const match = this.taxTypes().find((taxType) => taxType.id === row.taxTypeId);
    if (!match) {
      return row.taxTypeId;
    }
    return `${match.code} - ${match.name}`;
  }

  taxpayerClassificationLabel(value: unknown): string {
    const labels: Record<string, string> = {
      individual: 'Individual / Sole Proprietor',
      corporation: 'Corporation',
      partnership: 'Partnership',
      estate_trust: 'Estate / Trust',
      non_stock_non_profit: 'Non-stock / Non-profit',
      other: 'Other',
    };
    return labels[String(value || '').toLowerCase()] || '-';
  }

  loadTaxTypes(): void {
    this.api.list<TaxTypeOption>('/api/v1/tax-types?activeOnly=true').subscribe({
      next: (response) => {
        this.taxTypes.set(response.data || []);
      },
      error: () => {
        this.taxTypes.set([]);
      },
    });
  }

  private newOrgForm(): Record<string, unknown> {
    return {
      name: '',
      legalName: '',
      taxId: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: this.currentUserCountry,
      currency: this.currentOrganizationCurrency,
      taxTypeId: '',
      taxpayerClassification: '',
      deductionMethod: 'itemized',
      incomeTaxRate: null,
      isIncomeTaxExempt: false,
      contactName: '',
      contactEmail: '',
      phone: '',
      website: '',
      industry: '',
      employeeCount: 0,
      notes: '',
      isActive: true,
    };
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
    this.createOrganizationForm.patchValue({ taxId: masked }, { emitEvent: false });
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
    this.editOrganizationForm.patchValue({ taxId: masked }, { emitEvent: false });
  }

  private formatTaxId(raw: unknown): string {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 14);
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 14);
    return [p1, p2, p3, p4].filter(Boolean).join('-');
  }

  private newOrganizationFormGroup(initialValues: Partial<Record<string, unknown>> = {}): FormGroup {
    const defaults = { ...this.newOrgForm(), ...initialValues };
    const maskedTaxId = this.formatTaxId(defaults['taxId']);
    return this.fb.group({
      name: [defaults['name'], [Validators.required, Validators.maxLength(180)]],
      legalName: [defaults['legalName'], [Validators.maxLength(180)]],
      taxId: [maskedTaxId, [Validators.maxLength(120)]],
      addressLine1: [defaults['addressLine1'], [Validators.required, Validators.maxLength(255)]],
      addressLine2: [defaults['addressLine2'], [Validators.maxLength(255)]],
      city: [defaults['city'], [Validators.required, Validators.maxLength(120)]],
      state: [defaults['state'], [Validators.maxLength(120)]],
      postalCode: [defaults['postalCode'], [Validators.maxLength(20)]],
      country: [defaults['country'], [Validators.required]],
      currency: [defaults['currency'], [Validators.required]],
      taxTypeId: [defaults['taxTypeId'], [Validators.required]],
      taxpayerClassification: [defaults['taxpayerClassification']],
      deductionMethod: [defaults['deductionMethod']],
      incomeTaxRate: [defaults['incomeTaxRate'], [Validators.min(0)]],
      isIncomeTaxExempt: [defaults['isIncomeTaxExempt']],
      contactName: [defaults['contactName'], [Validators.maxLength(120)]],
      contactEmail: [defaults['contactEmail'], [Validators.required, Validators.email]],
      phone: [defaults['phone'], [Validators.required, Validators.maxLength(40)]],
      website: [defaults['website'], [Validators.maxLength(255)]],
      industry: [defaults['industry'], [Validators.maxLength(120)]],
      employeeCount: [defaults['employeeCount'], [Validators.min(0)]],
      notes: [defaults['notes'], [Validators.maxLength(2000)]],
      isActive: [defaults['isActive']],
    });
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      name: this.asString(form['name']),
      legalName: this.optionalString(form['legalName']),
      taxId: this.optionalString(form['taxId']),
      addressLine1: this.asString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.asString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      currency: this.optionalString(form['currency']),
      taxTypeId: this.asString(form['taxTypeId']),
      taxpayerClassification: this.optionalString(form['taxpayerClassification']),
      deductionMethod: this.optionalString(form['deductionMethod']),
      incomeTaxRate: this.optionalNumber(form['incomeTaxRate']),
      isIncomeTaxExempt: Boolean(form['isIncomeTaxExempt']),
      contactName: this.optionalString(form['contactName']),
      contactEmail: this.asString(form['contactEmail']),
      phone: this.asString(form['phone']),
      website: this.optionalString(form['website']),
      industry: this.optionalString(form['industry']),
      employeeCount: this.optionalNumber(form['employeeCount']),
      notes: this.optionalString(form['notes']),
      isActive: Boolean(form['isActive']),
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

  private buildCurrencyOptions(): CurrencyOption[] {
    const fallbackCodes = ['USD', 'PHP'];
    try {
      const intlAny = Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
        DisplayNames?: new (locales: string[], options: { type: 'currency' }) => Intl.DisplayNames;
      };
      const codes = Array.from(
        new Set(
          (intlAny.supportedValuesOf ? intlAny.supportedValuesOf('currency') : fallbackCodes).map(
            (value) => String(value || '').toUpperCase().trim()
          )
        )
      ).filter((value) => value.length === 3);

      const currencyNames = intlAny.DisplayNames
        ? new intlAny.DisplayNames(['en'], { type: 'currency' })
        : null;

      const options = codes
        .map((code) => {
          const name = currencyNames?.of(code);
          return {
            code,
            label: name ? `${code} - ${name}` : code,
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code));

      return options.length > 0 ? options : fallbackCodes.map((code) => ({ code, label: code }));
    } catch (_err) {
      return fallbackCodes.map((code) => ({ code, label: code }));
    }
  }
}
