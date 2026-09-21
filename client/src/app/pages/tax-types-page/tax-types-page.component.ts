import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { loadTablePreferences, saveTablePreferences, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface TaxTypeRow {
  id: string;
  code: string;
  name: string;
  description?: string;
  percentage: number;
  isActive?: boolean;
}

interface WithholdingTaxTypeRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  description?: string;
  percentage: number;
  appliesTo: 'expense' | 'invoice' | 'both';
  minimumBaseAmount?: number;
  isActive?: boolean;
}

@Component({
  selector: 'app-tax-types-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, TooltipDirective],
  templateUrl: './tax-types-page.component.html',
})
export class TaxTypesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  readonly taxRows = signal<TaxTypeRow[]>([]);
  readonly withholdingRows = signal<WithholdingTaxTypeRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isTaxCreateModalOpen = signal(false);
  readonly isWithholdingCreateModalOpen = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'tax-types-page';

  taxCreateForm: FormGroup = this.newTaxCreateForm();
  withholdingCreateForm: FormGroup = this.newWithholdingCreateForm();
  editingTaxId = '';
  editingWithholdingId = '';
  taxEditForm: Record<string, unknown> = this.newTaxForm();
  withholdingEditForm: Record<string, unknown> = this.newWithholdingForm();

  readonly filteredTaxRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.taxRows();
    return this.taxRows().filter((row) =>
      row.code.toLowerCase().includes(q)
      || row.name.toLowerCase().includes(q)
      || String(row.description || '').toLowerCase().includes(q)
    );
  });

  readonly filteredWithholdingRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) return this.withholdingRows();
    return this.withholdingRows().filter((row) =>
      row.code.toLowerCase().includes(q)
      || row.name.toLowerCase().includes(q)
      || String(row.description || '').toLowerCase().includes(q)
      || String(row.appliesTo || '').toLowerCase().includes(q)
    );
  });

  get activeOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get canManageWithholding(): boolean {
    if (this.organizationContext.isAllOrganizationsSelected()) {
      return false;
    }
    return Boolean(this.activeOrganizationId);
  }

  get canManageGlobalTaxes(): boolean {
    const user = this.auth.currentUser();
    const roleCodes = (user?.roleCodes || []).map((code) => String(code || '').toLowerCase());
    return roleCodes.includes('superuser') || roleCodes.includes('administrator');
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  formatMoney(value: unknown, currency?: string): string {
    const amount = Number(value ?? 0);
    const code = String(currency || this.currentOrganizationCurrency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(amount) ? amount : 0);
    } catch (_err) {
      return `${code} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
    }
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set('');
    this.message.set('');

    const q = this.filter().trim();
    const taxParams = new URLSearchParams();
    if (q) {
      taxParams.set('q', q);
    }
    const withholdingParams = new URLSearchParams();
    if (q) {
      withholdingParams.set('q', q);
    }
    if (this.activeOrganizationId) {
      withholdingParams.set('organizationId', this.activeOrganizationId);
    }

    this.api.list<TaxTypeRow>(`/api/v1/tax-types?${taxParams.toString()}`).subscribe({
      next: (taxResponse) => {
        this.taxRows.set(taxResponse.data || []);
        this.api
          .list<WithholdingTaxTypeRow>(`/api/v1/withholding-tax-types?${withholdingParams.toString()}`)
          .subscribe({
            next: (withholdingResponse) => {
              this.loading.set(false);
              this.withholdingRows.set(withholdingResponse.data || []);
            },
            error: (err) => {
              this.loading.set(false);
              this.withholdingRows.set([]);
              this.error.set(err?.error?.message || 'Unable to load withholding tax types.');
            },
          });
      },
      error: (err) => {
        this.loading.set(false);
        this.taxRows.set([]);
        this.withholdingRows.set([]);
        this.error.set(err?.error?.message || 'Unable to load tax types.');
      },
    });
  }

  openTaxCreateModal(): void {
    this.taxCreateForm = this.newTaxCreateForm();
    this.isTaxCreateModalOpen.set(true);
    this.error.set('');
  }

  closeTaxCreateModal(): void {
    this.isTaxCreateModalOpen.set(false);
  }

  createTaxType(): void {
    if (this.taxCreateForm.invalid) {
      this.taxCreateForm.markAllAsTouched();
      this.error.set('Please complete all required tax type fields.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.api.create<TaxTypeRow>('/api/v1/tax-types', this.buildTaxPayload(this.taxCreateForm.getRawValue())).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isTaxCreateModalOpen.set(false);
        this.message.set(response.message || 'Tax type created successfully.');
        this.loadAll();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create tax type.');
      },
    });
  }

  startTaxEdit(row: TaxTypeRow): void {
    this.editingTaxId = row.id;
    this.taxEditForm = {
      code: row.code || '',
      name: row.name || '',
      description: row.description || '',
      percentage: row.percentage ?? 0,
      isActive: row.isActive !== false,
    };
  }

  cancelTaxEdit(): void {
    this.editingTaxId = '';
    this.taxEditForm = this.newTaxForm();
  }

  async saveTaxEdit(): Promise<void> {
    if (!this.editingTaxId) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Tax Type',
      message: 'Save changes to this tax type?',
      confirmText: 'Update Tax Type',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) return;
    this.submitting.set(true);
    this.error.set('');
    this.api
      .update<TaxTypeRow>('/api/v1/tax-types', this.editingTaxId, this.buildTaxPayload(this.taxEditForm))
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          this.message.set(response.message || 'Tax type updated successfully.');
          this.cancelTaxEdit();
          this.loadAll();
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Unable to update tax type.');
        },
      });
  }

  async removeTaxType(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Tax Type',
      message: 'Delete this tax type? This action cannot be undone.',
      confirmText: 'Delete Tax Type',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-percent',
    });
    if (!confirmed) return;

    this.deletingId.set(id);
    this.error.set('');
    this.api.remove('/api/v1/tax-types', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Tax type deleted successfully.');
        this.loadAll();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete tax type.');
      },
    });
  }

  openWithholdingCreateModal(): void {
    this.withholdingCreateForm = this.newWithholdingCreateForm();
    this.isWithholdingCreateModalOpen.set(true);
    this.error.set('');
  }

  closeWithholdingCreateModal(): void {
    this.isWithholdingCreateModalOpen.set(false);
  }

  createWithholdingTaxType(): void {
    if (!this.canManageWithholding) {
      this.error.set('Select a specific organization first.');
      return;
    }
    if (this.withholdingCreateForm.invalid) {
      this.withholdingCreateForm.markAllAsTouched();
      this.error.set('Please complete all required withholding tax fields.');
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    const payload = {
      ...this.buildWithholdingPayload(this.withholdingCreateForm.getRawValue()),
      organizationId: this.activeOrganizationId,
    };
    this.api.create<WithholdingTaxTypeRow>('/api/v1/withholding-tax-types', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isWithholdingCreateModalOpen.set(false);
        this.message.set(response.message || 'Withholding tax type created successfully.');
        this.loadAll();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create withholding tax type.');
      },
    });
  }

  startWithholdingEdit(row: WithholdingTaxTypeRow): void {
    this.editingWithholdingId = row.id;
    this.withholdingEditForm = {
      code: row.code || '',
      name: row.name || '',
      description: row.description || '',
      percentage: row.percentage ?? 0,
      appliesTo: row.appliesTo || 'expense',
      minimumBaseAmount: row.minimumBaseAmount ?? 0,
      isActive: row.isActive !== false,
    };
  }

  cancelWithholdingEdit(): void {
    this.editingWithholdingId = '';
    this.withholdingEditForm = this.newWithholdingForm();
  }

  async saveWithholdingEdit(): Promise<void> {
    if (!this.editingWithholdingId) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Withholding Tax',
      message: 'Save changes to this withholding tax type?',
      confirmText: 'Update Withholding Tax',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) return;
    this.submitting.set(true);
    this.error.set('');
    this.api
      .update<WithholdingTaxTypeRow>(
        '/api/v1/withholding-tax-types',
        this.editingWithholdingId,
        this.buildWithholdingPayload(this.withholdingEditForm)
      )
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          this.message.set(response.message || 'Withholding tax type updated successfully.');
          this.cancelWithholdingEdit();
          this.loadAll();
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Unable to update withholding tax type.');
        },
      });
  }

  async removeWithholdingTaxType(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Withholding Tax',
      message: 'Delete this withholding tax type? This action cannot be undone.',
      confirmText: 'Delete Withholding Tax',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-percent',
    });
    if (!confirmed) return;

    this.deletingId.set(id);
    this.error.set('');
    this.api.remove('/api/v1/withholding-tax-types', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Withholding tax type deleted successfully.');
        this.loadAll();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete withholding tax type.');
      },
    });
  }

  trackById(_index: number, row: TaxTypeRow | WithholdingTaxTypeRow): string {
    return row.id;
  }

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.loadAll();
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  private newTaxForm(): Record<string, unknown> {
    return {
      code: '',
      name: '',
      description: '',
      percentage: 0,
      isActive: true,
    };
  }

  private newWithholdingForm(): Record<string, unknown> {
    return {
      code: '',
      name: '',
      description: '',
      percentage: 0,
      appliesTo: 'expense',
      minimumBaseAmount: 0,
      isActive: true,
    };
  }

  controlHasError(form: FormGroup, controlName: string, errorCode?: string): boolean {
    const control = form.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
  }

  private newTaxCreateForm(): FormGroup {
    const defaults = this.newTaxForm();
    return this.fb.group({
      code: [defaults['code'], [Validators.required, Validators.maxLength(30)]],
      name: [defaults['name'], [Validators.required, Validators.maxLength(120)]],
      description: [defaults['description'], [Validators.maxLength(500)]],
      percentage: [defaults['percentage'], [Validators.required, Validators.min(0)]],
      isActive: [defaults['isActive']],
    });
  }

  private newWithholdingCreateForm(): FormGroup {
    const defaults = this.newWithholdingForm();
    return this.fb.group({
      code: [defaults['code'], [Validators.required, Validators.maxLength(40)]],
      name: [defaults['name'], [Validators.required, Validators.maxLength(120)]],
      description: [defaults['description'], [Validators.maxLength(500)]],
      percentage: [defaults['percentage'], [Validators.required, Validators.min(0)]],
      appliesTo: [defaults['appliesTo'], [Validators.required]],
      minimumBaseAmount: [defaults['minimumBaseAmount'], [Validators.required, Validators.min(0)]],
      isActive: [defaults['isActive']],
    });
  }

  private buildTaxPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      code: String(form['code'] || '').trim().toUpperCase(),
      name: String(form['name'] || '').trim(),
      description: String(form['description'] || '').trim() || undefined,
      percentage: Number(form['percentage'] || 0),
      isActive: Boolean(form['isActive']),
    };
  }

  private buildWithholdingPayload(form: Record<string, unknown>): Record<string, unknown> {
    return {
      code: String(form['code'] || '').trim().toUpperCase(),
      name: String(form['name'] || '').trim(),
      description: String(form['description'] || '').trim() || undefined,
      percentage: Number(form['percentage'] || 0),
      appliesTo: String(form['appliesTo'] || 'expense'),
      minimumBaseAmount: Number(form['minimumBaseAmount'] || 0),
      isActive: Boolean(form['isActive']),
    };
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      viewMode: this.viewMode,
    });
  }
}
