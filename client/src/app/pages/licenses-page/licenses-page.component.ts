import { RowActionsComponent } from '../../shared/row-actions.component';
import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { LicenseExtendDialogComponent, LicenseExtendedEvent } from '../../shared/license-extend-dialog.component';
import {
  LICENSE_PLANS,
  LICENSE_STATUS_FILTER_OPTIONS,
  LicenseOrganization,
  LicenseRow,
  LicenseState,
  LicenseSummary,
  addMonthsLocal,
  badgeClass,
  createLicenseForm,
  generateUuid,
  licenseFieldError,
  licensePayload,
  licenseState,
  organizationLabel,
  planOptions,
  seatSummary,
  statusFilterLabel,
  toDateTimeLocal,
} from '../../shared/license-utils';

type LicenseListResponse = ApiResponse<LicenseRow[]> & { meta?: ApiResponse<LicenseRow[]>['meta'] & { summary?: LicenseSummary } };
type LicenseWriteResponse = ApiResponse<LicenseRow> & { meta?: { warnings?: string[] } };

@Component({
  selector: 'app-licenses-page',
  standalone: true,
  imports: [RowActionsComponent, ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective, LicenseExtendDialogComponent],
  templateUrl: './licenses-page.component.html',
})
export class LicensesPageComponent {
  private readonly api = inject(ApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  readonly rows = signal<LicenseRow[]>([]);
  readonly organizations = signal<LicenseOrganization[]>([]);
  readonly summary = signal<LicenseSummary | null>(null);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly busyId = signal('');
  readonly isCreateModalOpen = signal(false);
  readonly extendTarget = signal<LicenseRow | null>(null);
  readonly copiedId = signal('');

  readonly message = signal('');
  readonly warnings = signal<string[]>([]);
  readonly error = signal('');
  readonly createModalError = signal('');
  readonly createOverlapWarning = signal('');

  readonly filter = signal('');
  statusFilter = '';
  planFilter = '';
  readonly statusOptions = LICENSE_STATUS_FILTER_OPTIONS;
  readonly planFilterOptions = LICENSE_PLANS;
  readonly pageSizeOptions = [10, 20, 50, 100];
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'licenses-page';

  createLicenseForm: FormGroup = this.newCreateLicenseForm();

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  /** License changes are platform-only; organization administrators see their own licenses read-only. */
  get canManage(): boolean {
    return this.isSuperuser;
  }

  get hasActiveFilters(): boolean {
    return this.activeFilterCount > 0;
  }

  get activeFilterCount(): number {
    return [this.filter().trim(), this.statusFilter, this.planFilter].filter(Boolean).length;
  }

  get createPlanOptions() {
    return planOptions(this.createLicenseForm.get('planName')?.value);
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.load();
    if (this.canManage) {
      this.loadOrganizations();
    }
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const params = new URLSearchParams({ page: String(this.page), limit: String(this.pageSize) });
    const q = this.filter().trim();
    if (q) params.set('q', q);
    if (this.statusFilter) params.set('status', this.statusFilter);
    if (this.planFilter) params.set('planName', this.planFilter);

    this.api.list<LicenseRow>(`/api/v1/licenses?${params.toString()}`).subscribe({
      next: (response: LicenseListResponse) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
        const meta = response.meta || {};
        this.summary.set(meta.summary || null);
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
    this.api.list<LicenseOrganization>('/api/v1/organizations?limit=200').subscribe({
      next: (response: ApiResponse<LicenseOrganization[]>) => this.organizations.set(response.data || []),
      error: () => this.organizations.set([]),
    });
  }

  // Filters

  onFilterChange(value: string): void {
    this.filter.set(value);
    this.reloadFromFirstPage();
  }

  clearSearch(): void {
    this.onFilterChange('');
  }

  onStatusFilterChange(value: string): void {
    this.statusFilter = value || '';
    this.reloadFromFirstPage();
  }

  onPlanFilterChange(value: string): void {
    this.planFilter = value || '';
    this.reloadFromFirstPage();
  }

  /** The overview tiles act as status filters; clicking the active one clears it. */
  toggleStatusFilter(value: string): void {
    this.onStatusFilterChange(this.statusFilter === value ? '' : value);
  }

  clearFilters(): void {
    this.filter.set('');
    this.statusFilter = '';
    this.planFilter = '';
    this.reloadFromFirstPage();
  }

  statusFilterLabel(value: string): string {
    return statusFilterLabel(value);
  }

  onPageSizeChange(value: string): void {
    const parsed = Number(value);
    this.pageSize = Number.isFinite(parsed) ? parsed : 20;
    this.reloadFromFirstPage();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page || this.loading()) {
      return;
    }
    this.page = page;
    this.persistTablePreferences();
    this.load();
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  private reloadFromFirstPage(): void {
    this.page = 1;
    this.persistTablePreferences();
    this.load();
  }

  // Create

  openCreateModal(): void {
    if (!this.canManage) return;
    this.createLicenseForm = this.newCreateLicenseForm();
    this.createModalError.set('');
    this.createOverlapWarning.set('');
    this.clearNotices();
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    if (!this.submitting()) this.isCreateModalOpen.set(false);
  }

  onCreatePlanChange(): void {
    const plan = LICENSE_PLANS.find((option) => option.name === this.createLicenseForm.get('planName')?.value);
    if (plan) {
      this.createLicenseForm.patchValue({ maxUsers: plan.includedUsers });
    }
  }

  onCreateOrganizationChange(): void {
    const organizationId = String(this.createLicenseForm.get('organizationId')?.value || '');
    this.createOverlapWarning.set('');
    if (!organizationId) return;
    this.api.list<LicenseRow>(`/api/v1/licenses?organizationId=${encodeURIComponent(organizationId)}&status=active&limit=1`).subscribe({
      next: (response) => {
        const current = response.data?.[0];
        if (current && this.createLicenseForm.get('organizationId')?.value === organizationId) {
          const until = current.expiresAt ? new Date(current.expiresAt).toLocaleDateString() : 'an open date';
          this.createOverlapWarning.set(
            `This organization already has an active ${current.planName || ''} license until ${until}. A new license will apply alongside it. To renew, extend the existing license instead.`
          );
        }
      },
      error: () => {},
    });
  }

  setCreateTerm(months: number): void {
    const startsAt = String(this.createLicenseForm.get('startsAt')?.value || '');
    this.createLicenseForm.patchValue({ expiresAt: addMonthsLocal(startsAt, months) });
    this.createLicenseForm.get('expiresAt')?.markAsTouched();
  }

  generateKey(): void {
    this.createLicenseForm.patchValue({ key: generateUuid() });
  }

  createFieldError(name: string): string {
    return licenseFieldError(this.createLicenseForm, name);
  }

  createLicense(): void {
    if (this.submitting()) return;
    if (this.createLicenseForm.invalid) {
      this.createLicenseForm.markAllAsTouched();
      this.createModalError.set('Please fix the highlighted fields.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.clearNotices();

    this.api.create<LicenseRow>('/api/v1/licenses', licensePayload(this.createLicenseForm.getRawValue(), true)).subscribe({
      next: (response: LicenseWriteResponse) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'License created successfully.');
        this.warnings.set(response.meta?.warnings || []);
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create license.');
      },
    });
  }

  // Row actions

  openExtend(row: LicenseRow): void {
    this.clearNotices();
    this.extendTarget.set(row);
  }

  onExtended(event: LicenseExtendedEvent): void {
    this.extendTarget.set(null);
    this.message.set(event.message);
    this.warnings.set(event.warnings);
    this.load();
  }

  async revokeLicense(row: LicenseRow): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Revoke License',
      message: `Revoke the ${row.planName || ''} license for ${organizationLabel(row)}? Its members lose access immediately and are notified by email.`,
      confirmText: 'Revoke License',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-shield-x',
    });
    if (!confirmed) return;
    this.runRowAction(row.id, this.api.create<LicenseRow>(`/api/v1/licenses/${row.id}/revoke`, {}), 'License revoked successfully.', 'Unable to revoke license.');
  }

  async removeLicense(row: LicenseRow): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete License',
      message: row.status === 'active'
        ? 'This license is active. Deleting it removes access for its organization and its history. Revoke it instead to keep a record.'
        : 'Delete this license and its history? This action cannot be undone.',
      confirmText: 'Delete License',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-patch-minus',
    });
    if (!confirmed) return;
    this.runRowAction(row.id, this.api.remove('/api/v1/licenses', row.id), 'License deleted successfully.', 'Unable to delete license.');
  }

  private runRowAction(id: string, request: ReturnType<ApiService['remove']>, success: string, failure: string): void {
    this.busyId.set(id);
    this.clearNotices();
    request.subscribe({
      next: (response) => {
        this.busyId.set('');
        this.message.set(response.message || success);
        this.load();
      },
      error: (err) => {
        this.busyId.set('');
        this.error.set(err?.error?.message || failure);
      },
    });
  }

  copyKey(row: LicenseRow): void {
    navigator.clipboard?.writeText(row.key).then(() => {
      this.copiedId.set(row.id);
      setTimeout(() => this.copiedId() === row.id && this.copiedId.set(''), 1500);
    }).catch(() => {});
  }

  // Display helpers

  state(row: LicenseRow): LicenseState {
    return licenseState(row);
  }

  badgeClass(row: LicenseRow): string {
    return badgeClass(this.state(row).tone);
  }

  seats(row: LicenseRow) {
    return seatSummary(row);
  }

  organizationLabel(row: LicenseRow): string {
    return organizationLabel(row);
  }

  organizationOptionLabel(org: LicenseOrganization): string {
    return org.name || org.legalName || org.id;
  }

  trackById(_index: number, row: LicenseRow): string {
    return row.id;
  }

  private clearNotices(): void {
    this.message.set('');
    this.warnings.set([]);
    this.error.set('');
  }

  private newCreateLicenseForm(): FormGroup {
    const startsAt = toDateTimeLocal(new Date());
    return createLicenseForm(this.fb, {
      key: generateUuid(),
      startsAt,
      expiresAt: addMonthsLocal(startsAt, 12),
      maxUsers: null,
    });
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
}
