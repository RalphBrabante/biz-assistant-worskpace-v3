import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';

interface LicenseRow {
  id: string;
  organizationId?: string | null;
  key: string;
  planName?: string;
  status?: string;
  startsAt?: string;
  expiresAt?: string;
  revokedAt?: string;
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
  selector: 'app-license-edit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './license-edit-page.component.html',
})
export class LicenseEditPageComponent {
  private readonly confirmDialog = inject(ConfirmDialogService);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly organizations = signal<OrganizationOption[]>([]);
  readonly license = signal<LicenseRow | null>(null);

  licenseId = '';
  form: Record<string, unknown> = this.newForm();

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.licenseId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.licenseId) {
      this.error.set('License ID is missing.');
      return;
    }
    this.loadOrganizations();
    this.loadLicense();
  }

  loadLicense(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<LicenseRow>(`/api/v1/licenses/${this.licenseId}`).subscribe({
      next: (response: ApiResponse<LicenseRow>) => {
        const row = response.data || null;
        this.loading.set(false);
        this.license.set(row);
        if (row) {
          this.form = {
            organizationId: row.organizationId || '',
            key: row.key || '',
            planName: row.planName || '',
            status: row.status || 'active',
            startsAt: this.toDateTimeLocal(row.startsAt),
            expiresAt: this.toDateTimeLocal(row.expiresAt),
            revokedAt: this.toDateTimeLocal(row.revokedAt),
            maxUsers: row.maxUsers ?? 0,
            isActive: row.isActive !== false,
            notes: row.notes || '',
          };
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load license.');
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

  async save(): Promise<void> {
    if (!this.licenseId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update License',
      message: 'Save changes to this license?',
      confirmText: 'Update License',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = this.buildPayload(this.form);

    this.api.update<LicenseRow>('/api/v1/licenses', this.licenseId, payload).subscribe({
      next: (response: ApiResponse<LicenseRow>) => {
        this.submitting.set(false);
        this.message.set(response.message || 'License updated successfully.');
        this.loadLicense();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update license.');
      },
    });
  }

  async revoke(): Promise<void> {
    if (!this.licenseId || this.submitting()) {
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Revoke License',
      message: 'Revoke this license? This will mark it inactive.',
      confirmText: 'Revoke License',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-shield-x',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    this.api.create<LicenseRow>(`/api/v1/licenses/${this.licenseId}/revoke`, {}).subscribe({
      next: (response: ApiResponse<LicenseRow>) => {
        this.submitting.set(false);
        this.message.set(response.message || 'License revoked successfully.');
        this.loadLicense();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to revoke license.');
      },
    });
  }

  backToList(): void {
    void this.router.navigate(['/licenses']);
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  private newForm(): Record<string, unknown> {
    return {
      organizationId: '',
      key: '',
      planName: '',
      status: 'active',
      startsAt: '',
      expiresAt: '',
      revokedAt: '',
      maxUsers: 0,
      isActive: true,
      notes: '',
    };
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    const organizationId = this.optionalString(form['organizationId']);
    return {
      organizationId: organizationId || null,
      planName: this.optionalString(form['planName']),
      status: this.optionalString(form['status']),
      startsAt: this.optionalDate(form['startsAt']),
      expiresAt: this.optionalDate(form['expiresAt']),
      maxUsers: this.optionalNumber(form['maxUsers']),
      isActive: Boolean(form['isActive']),
      notes: this.optionalString(form['notes']),
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

  private optionalDate(value: unknown): string | undefined {
    const cleaned = String(value || '').trim();
    return cleaned ? cleaned : undefined;
  }

  private toDateTimeLocal(value: unknown): string {
    if (!value) {
      return '';
    }

    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
