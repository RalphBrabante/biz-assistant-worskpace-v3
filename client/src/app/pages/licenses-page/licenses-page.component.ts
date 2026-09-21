import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface LicenseRow {
  id: string;
  organizationId?: string | null;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  key: string;
  planName?: string;
  status?: string;
  startsAt?: string;
  expiresAt?: string;
  maxUsers?: number;
  isActive?: boolean;
  notes?: string;
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

@Component({
  selector: 'app-licenses-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './licenses-page.component.html',
})
export class LicensesPageComponent {
  private readonly api: ApiService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  constructor(api: ApiService) {
    this.api = api;
  }

  readonly rows = signal<LicenseRow[]>([]);
  readonly organizations = signal<OrganizationOption[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly createModalError = signal('');
  readonly filter = signal('');
  readonly pageSizeOptions = [10, 20, 50, 100];
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'licenses-page';

  createLicenseForm: FormGroup = this.newCreateLicenseForm();

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.key || '').toLowerCase().includes(q) ||
        String(row.planName || '').toLowerCase().includes(q) ||
        String(row.status || '').toLowerCase().includes(q) ||
        String(row.organization?.name || '').toLowerCase().includes(q) ||
        String(row.organization?.legalName || '').toLowerCase().includes(q)
      );
    });
  });

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.load();
    this.loadOrganizations();
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

    this.api.list<LicenseRow>(`/api/v1/licenses?${params.toString()}`).subscribe({
      next: (response: ApiResponse<LicenseRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load licenses.');
      },
    });
  }

  loadOrganizations(): void {
    this.api.list<OrganizationOption>('/api/v1/organizations?limit=200').subscribe({
      next: (response: ApiResponse<OrganizationOption[]>) => {
        this.organizations.set(response.data || []);
      },
      error: () => {
        this.organizations.set([]);
      },
    });
  }

  openCreateModal(): void {
    this.createLicenseForm = this.newCreateLicenseForm();
    this.createModalError.set('');
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createLicense(): void {
    if (this.createLicenseForm.invalid) {
      this.createLicenseForm.markAllAsTouched();
      this.createModalError.set('Please complete all required license fields.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.createLicenseForm.getRawValue(), true);

    this.api.create<LicenseRow>('/api/v1/licenses', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'License created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create license.');
      },
    });
  }

  async removeLicense(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete License',
      message: 'Delete this license? This action cannot be undone.',
      confirmText: 'Delete License',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-patch-minus',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/licenses', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'License deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete license.');
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

  trackById(_index: number, row: LicenseRow): string {
    return row.id;
  }

  private newLicenseForm(): Record<string, unknown> {
    return {
      organizationId: '',
      key: this.generateUuid(),
      planName: '',
      status: 'active',
      startsAt: '',
      expiresAt: '',
      maxUsers: 0,
      isActive: true,
      notes: '',
    };
  }

  private newCreateLicenseForm(): FormGroup {
    const defaults = this.newLicenseForm();
    return this.fb.group(
      {
        organizationId: [defaults['organizationId']],
        key: [defaults['key'], [Validators.required]],
        planName: [defaults['planName'], [Validators.required, Validators.maxLength(120)]],
        status: [defaults['status'], [Validators.required, Validators.maxLength(50)]],
        startsAt: [defaults['startsAt']],
        expiresAt: [defaults['expiresAt']],
        maxUsers: [defaults['maxUsers'], [Validators.required, Validators.min(0)]],
        isActive: [defaults['isActive']],
        notes: [defaults['notes'], [Validators.maxLength(1000)]],
      },
      { validators: [this.licenseDateRangeValidator] }
    );
  }

  private buildPayload(form: Record<string, unknown>, includeKey: boolean): Record<string, unknown> {
    const organizationId = this.optionalString(form['organizationId']);
    const payload: Record<string, unknown> = {
      organizationId: organizationId || null,
      planName: this.optionalString(form['planName']),
      status: this.optionalString(form['status']),
      startsAt: this.optionalDate(form['startsAt']),
      expiresAt: this.optionalDate(form['expiresAt']),
      maxUsers: this.optionalNumber(form['maxUsers']),
      isActive: Boolean(form['isActive']),
      notes: this.optionalString(form['notes']),
    };

    if (includeKey) {
      payload['key'] = this.asString(form['key']);
    }

    return payload;
  }

  generateKey(): void {
    this.createLicenseForm.patchValue({ key: this.generateUuid() });
  }

  controlHasError(controlName: string, errorCode?: string): boolean {
    const control = this.createLicenseForm.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
  }

  hasCreateFormError(errorCode: string): boolean {
    return !!this.createLicenseForm.errors?.[errorCode];
  }

  private licenseDateRangeValidator(control: AbstractControl): ValidationErrors | null {
    const startsAt = String(control.get('startsAt')?.value || '').trim();
    const expiresAt = String(control.get('expiresAt')?.value || '').trim();
    if (!startsAt || !expiresAt) {
      return null;
    }
    if (new Date(expiresAt).getTime() < new Date(startsAt).getTime()) {
      return { invalidDateRange: true };
    }
    return null;
  }

  organizationLabel(row: LicenseRow): string {
    if (row.organization?.name) {
      return row.organization.name;
    }
    if (row.organization?.legalName) {
      return row.organization.legalName;
    }
    return row.organizationId ? row.organizationId : 'Unassigned';
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  isExpired(row: LicenseRow): boolean {
    const expiresAt = String(row.expiresAt || '').trim();
    if (!expiresAt) return false;
    const expiresTime = new Date(expiresAt).getTime();
    if (Number.isNaN(expiresTime)) return false;
    return expiresTime < Date.now();
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

  private optionalDate(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }

  private generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = Math.floor(Math.random() * 16);
      const value = char === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }
}
