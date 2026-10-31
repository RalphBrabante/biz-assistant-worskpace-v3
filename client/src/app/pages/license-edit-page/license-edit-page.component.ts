import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { LicenseExtendDialogComponent, LicenseExtendedEvent } from '../../shared/license-extend-dialog.component';
import {
  LICENSE_PLANS,
  LICENSE_STATUS_OPTIONS,
  LicenseOrganization,
  LicenseRow,
  LicenseState,
  badgeClass,
  createLicenseForm,
  licenseFieldError,
  licensePayload,
  licenseState,
  organizationLabel,
  planOptions,
  seatSummary,
  toDateTimeLocal,
} from '../../shared/license-utils';

type LicenseResponse = ApiResponse<LicenseRow> & { meta?: { warnings?: string[] } };

@Component({
  selector: 'app-license-edit-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, TooltipDirective, LicenseExtendDialogComponent],
  templateUrl: './license-edit-page.component.html',
})
export class LicenseEditPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly warnings = signal<string[]>([]);
  readonly organizations = signal<LicenseOrganization[]>([]);
  readonly license = signal<LicenseRow | null>(null);
  readonly extendOpen = signal(false);
  readonly copied = signal(false);

  readonly statusOptions = LICENSE_STATUS_OPTIONS;
  licenseId = '';
  form: FormGroup = createLicenseForm(this.fb);

  get canManage(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get state(): LicenseState {
    return licenseState(this.license());
  }

  get badgeClass(): string {
    return badgeClass(this.state.tone);
  }

  get seats() {
    return seatSummary(this.license());
  }

  get organizationName(): string {
    const row = this.license();
    return row ? organizationLabel(row) : '';
  }

  get planOptions() {
    return planOptions(this.form.get('planName')?.value);
  }

  get isRevoked(): boolean {
    return this.license()?.status === 'revoked';
  }

  ngOnInit(): void {
    this.licenseId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.licenseId) {
      this.error.set('License ID is missing.');
      return;
    }
    if (this.canManage) {
      this.loadOrganizations();
    }
    this.loadLicense();
  }

  loadLicense(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<LicenseRow>(`/api/v1/licenses/${this.licenseId}`).subscribe({
      next: (response: LicenseResponse) => {
        this.loading.set(false);
        const row = response.data || null;
        this.license.set(row);
        if (response.meta?.warnings?.length && !this.warnings().length) {
          this.warnings.set(response.meta.warnings);
        }
        if (row) {
          this.form = createLicenseForm(this.fb, {
            organizationId: row.organizationId || '',
            key: row.key || '',
            planName: row.planName || '',
            status: row.status || 'active',
            startsAt: toDateTimeLocal(row.startsAt),
            expiresAt: toDateTimeLocal(row.expiresAt),
            maxUsers: row.maxUsers ? row.maxUsers : null,
            isActive: row.isActive !== false,
            notes: row.notes || '',
          });
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load license.');
      },
    });
  }

  loadOrganizations(): void {
    this.api.list<LicenseOrganization>('/api/v1/organizations?limit=200').subscribe({
      next: (response: ApiResponse<LicenseOrganization[]>) => this.organizations.set(response.data || []),
      error: () => this.organizations.set([]),
    });
  }

  fieldError(name: string): string {
    return licenseFieldError(this.form, name);
  }

  onPlanChange(): void {
    const plan = LICENSE_PLANS.find((option) => option.name === this.form.get('planName')?.value);
    if (plan && !this.form.get('maxUsers')?.dirty) {
      this.form.patchValue({ maxUsers: plan.includedUsers });
    }
  }

  /** Changes that take access away from an organization are confirmed first. */
  private accessLossReason(): string {
    const current = this.license();
    const next = this.form.getRawValue();
    if (!current) return '';
    if (next.status === 'revoked' && current.status !== 'revoked') return 'Revoking this license signs out its members and emails them.';
    if (next.status === 'suspended' && current.status !== 'suspended') return 'Suspending this license blocks its members from signing in.';
    if (next.isActive === false && current.isActive !== false) return 'Disabling this license blocks its members from signing in.';
    if ((next.organizationId || null) !== (current.organizationId || null) && current.organizationId) {
      return `Moving this license away from ${organizationLabel(current)} removes their access unless they have another license.`;
    }
    return '';
  }

  async save(): Promise<void> {
    if (!this.licenseId || this.submitting() || !this.canManage) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Please fix the highlighted fields.');
      return;
    }
    const reason = this.accessLossReason();
    if (reason) {
      const confirmed = await this.confirmDialog.confirm({
        title: 'Save License Changes',
        message: reason,
        confirmText: 'Save Changes',
        confirmButtonClass: 'ui-btn-danger',
        iconClass: 'bi-exclamation-triangle',
      });
      if (!confirmed) return;
    }
    this.send(this.api.update<LicenseRow>('/api/v1/licenses', this.licenseId, licensePayload(this.form.getRawValue(), false)), 'License updated successfully.', 'Unable to update license.');
  }

  async revoke(): Promise<void> {
    if (!this.licenseId || this.submitting()) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Revoke License',
      message: `Revoke this license? Members of ${this.organizationName} lose access immediately and are notified by email.`,
      confirmText: 'Revoke License',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-shield-x',
    });
    if (!confirmed) return;
    this.send(this.api.create<LicenseRow>(`/api/v1/licenses/${this.licenseId}/revoke`, {}), 'License revoked successfully.', 'Unable to revoke license.');
  }

  async reinstate(): Promise<void> {
    if (!this.licenseId || this.submitting()) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Reinstate License',
      message: `Make this license active again? Members of ${this.organizationName} can sign in as long as it has not expired.`,
      confirmText: 'Reinstate',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-arrow-counterclockwise',
    });
    if (!confirmed) return;
    this.send(this.api.update<LicenseRow>('/api/v1/licenses', this.licenseId, { status: 'active' }), 'License reinstated.', 'Unable to reinstate license.');
  }

  onExtended(event: LicenseExtendedEvent): void {
    this.extendOpen.set(false);
    this.message.set(event.message);
    this.warnings.set(event.warnings);
    this.loadLicense();
  }

  copyKey(): void {
    const key = this.license()?.key;
    if (!key) return;
    navigator.clipboard?.writeText(key).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    }).catch(() => {});
  }

  backToList(): void {
    void this.router.navigate(['/licenses']);
  }

  organizationOptionLabel(org: LicenseOrganization): string {
    return org.name || org.legalName || org.id;
  }

  private send(request: Observable<LicenseResponse>, success: string, failure: string): void {
    this.submitting.set(true);
    this.error.set('');
    this.message.set('');
    this.warnings.set([]);
    request.subscribe({
      next: (response: LicenseResponse) => {
        this.submitting.set(false);
        this.message.set(response.message || success);
        this.warnings.set(response.meta?.warnings || []);
        this.loadLicense();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || failure);
      },
    });
  }
}
