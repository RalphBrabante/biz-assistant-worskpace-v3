import { CountrySelectComponent } from '../../shared/country-select.component';
import { getBrowserCountry } from '../../shared/countries';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';

interface RoleRow {
  id: string;
  name?: string;
  code?: string;
  description?: string;
}

interface UserRoleRow {
  id: string;
  name?: string;
  code?: string;
  description?: string;
  UserRole?: {
    id?: string;
    assignedByUserId?: string;
    createdAt?: string;
  };
}

interface UserDetail {
  id: string;
  organizationId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  status?: string;
  isEmailVerified?: boolean;
  isActive?: boolean;
  role?: string;
  roles?: UserRoleRow[];
  organizations?: UserOrganizationRow[];
}

interface UserOrganizationRow {
  id: string;
  name?: string;
  legalName?: string;
  taxId?: string;
  isActive?: boolean;
  OrganizationUser?: {
    id?: string;
    role?: string;
    isActive?: boolean;
    isPrimary?: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
}

@Component({
  selector: 'app-user-detail-page',
  standalone: true,
  imports: [CountrySelectComponent, CommonModule, FormsModule, RouterLink],
  templateUrl: './user-detail-page.component.html',
})
export class UserDetailPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly assigning = signal(false);
  readonly assigningOrganization = signal(false);
  readonly removingRoleId = signal('');
  readonly removingOrganizationId = signal('');

  readonly message = signal('');
  readonly error = signal('');

  readonly user = signal<UserDetail | null>(null);
  readonly assignableRoles = signal<RoleRow[]>([]);
  readonly assignableOrganizations = signal<UserOrganizationRow[]>([]);

  selectedRoleId = '';
  selectedPrimaryOrganizationId = '';
  selectedOrganizationId = '';
  addOrganizationAsPrimary = false;
  form: Record<string, unknown> = {};

  get isSuperuser(): boolean {
    const roleCodes = this.auth.currentUser()?.roleCodes || [];
    return roleCodes.some((code) => String(code || '').toLowerCase() === 'superuser');
  }

  get userId(): string {
    return String(this.route.snapshot.paramMap.get('id') || '').trim();
  }

  ngOnInit(): void {
    if (!this.userId) {
      this.error.set('User id is required.');
      return;
    }

    this.loadUser();
    this.loadAssignableRoles();
    this.loadAssignableOrganizations();
  }

  loadUser(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<UserDetail>(`/api/v1/users/${this.userId}`).subscribe({
      next: (response: ApiResponse<UserDetail>) => {
        this.loading.set(false);
        const user = response.data || null;
        this.user.set(user);
        this.form = {
          organizationId: user?.organizationId || '',
          firstName: user?.firstName || '',
          lastName: user?.lastName || '',
          email: user?.email || '',
          password: '',
          phone: user?.phone || '',
          addressLine1: user?.addressLine1 || '',
          addressLine2: user?.addressLine2 || '',
          city: user?.city || '',
          state: user?.state || '',
          postalCode: user?.postalCode || '',
          country: user?.country || getBrowserCountry(),
          status: user?.status || 'pending_verification',
          role: user?.role || '',
          isEmailVerified: user?.isEmailVerified === true,
          isActive: user?.isActive !== false,
        };
        const primaryMembership = (user?.organizations || []).find(
          (org) => org?.OrganizationUser?.isPrimary === true
        );
        this.selectedPrimaryOrganizationId = String(
          primaryMembership?.id || user?.organizationId || ''
        ).trim();
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load user details.');
      },
    });
  }

  loadAssignableRoles(): void {
    this.api.list<RoleRow>(`/api/v1/users/${this.userId}/assignable-roles`).subscribe({
      next: (response: ApiResponse<RoleRow[]>) => {
        this.assignableRoles.set(response.data || []);
      },
      error: () => {
        this.assignableRoles.set([]);
      },
    });
  }

  loadAssignableOrganizations(): void {
    if (!this.isSuperuser) {
      this.assignableOrganizations.set([]);
      return;
    }
    this.api.list<UserOrganizationRow>(`/api/v1/users/${this.userId}/assignable-organizations`).subscribe({
      next: (response: ApiResponse<UserOrganizationRow[]>) => {
        this.assignableOrganizations.set(response.data || []);
      },
      error: () => {
        this.assignableOrganizations.set([]);
      },
    });
  }

  async saveUser(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update User',
      message: 'Save changes to this user profile?',
      confirmText: 'Update User',
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

    this.api.update<UserDetail>('/api/v1/users', this.userId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'User updated successfully.');
        this.loadUser();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update user.');
      },
    });
  }

  assignRole(): void {
    if (!this.selectedRoleId.trim()) {
      this.error.set('Please select a role to assign.');
      return;
    }

    this.assigning.set(true);
    this.error.set('');
    this.message.set('');

    this.api.create(`/api/v1/users/${this.userId}/roles`, { roleId: this.selectedRoleId.trim() }).subscribe({
      next: (response) => {
        this.assigning.set(false);
        this.message.set(response.message || 'Role assigned successfully.');
        this.selectedRoleId = '';
        this.loadUser();
      },
      error: (err) => {
        this.assigning.set(false);
        this.error.set(err?.error?.message || 'Unable to assign role.');
      },
    });
  }

  async removeRole(roleId: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Role',
      message: 'Remove this role from the user?',
      confirmText: 'Remove Role',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-person-dash',
    });
    if (!confirmed) {
      return;
    }
    this.removingRoleId.set(roleId);
    this.error.set('');
    this.message.set('');

    this.api.remove(`/api/v1/users/${this.userId}/roles`, roleId).subscribe({
      next: (response) => {
        this.removingRoleId.set('');
        this.message.set(response.message || 'Role removed successfully.');
        this.loadUser();
      },
      error: (err) => {
        this.removingRoleId.set('');
        this.error.set(err?.error?.message || 'Unable to remove role.');
      },
    });
  }

  roleChipClass(code: string | undefined): string {
    const normalized = String(code || '').toLowerCase();
    if (normalized === 'administrator' || normalized === 'superuser') return 'ui-badge-danger';
    if (normalized === 'accountant' || normalized === 'inventorymanager') return 'ui-badge-primary';
    if (normalized === 'enduser') return 'ui-badge-secondary';
    return 'ui-badge-light border border-line text-muted';
  }

  organizationLabel(row: UserOrganizationRow): string {
    return String(row.name || row.legalName || row.id || '-').trim() || '-';
  }

  async savePrimaryOrganization(): Promise<void> {
    if (!this.isSuperuser) {
      this.error.set('Only superusers can set a primary organization.');
      return;
    }

    const selectedId = String(this.selectedPrimaryOrganizationId || '').trim();
    if (!selectedId) {
      this.error.set('Select a primary organization first.');
      return;
    }

    const user = this.user();
    const currentId = String(user?.organizationId || '').trim();
    if (currentId && currentId === selectedId) {
      this.message.set('Primary organization is already set.');
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Set Primary Organization',
      message: 'Set this as the user’s default organization on login?',
      confirmText: 'Set Primary',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-building-check',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    this.api.update<UserDetail>('/api/v1/users', this.userId, { organizationId: selectedId }).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Primary organization updated successfully.');
        this.loadUser();
        this.loadAssignableOrganizations();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update primary organization.');
      },
    });
  }

  trackByRoleId(_index: number, role: UserRoleRow): string {
    return role.id;
  }

  trackByOrganizationId(_index: number, organization: UserOrganizationRow): string {
    return organization.id;
  }

  async addOrganizationMembership(): Promise<void> {
    if (!this.isSuperuser) {
      this.error.set('Only superusers can assign organizations.');
      return;
    }
    const organizationId = String(this.selectedOrganizationId || '').trim();
    if (!organizationId) {
      this.error.set('Select an organization to assign.');
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Assign Organization',
      message: this.addOrganizationAsPrimary
        ? 'Assign this organization and set it as primary?'
        : 'Assign this organization to the user?',
      confirmText: 'Assign',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-buildings',
    });
    if (!confirmed) {
      return;
    }

    this.assigningOrganization.set(true);
    this.error.set('');
    this.message.set('');
    this.api
      .create(`/api/v1/users/${this.userId}/organizations`, {
        organizationId,
        isPrimary: this.addOrganizationAsPrimary,
      })
      .subscribe({
        next: (response) => {
          this.assigningOrganization.set(false);
          this.message.set(response.message || 'Organization assigned successfully.');
          this.selectedOrganizationId = '';
          this.addOrganizationAsPrimary = false;
          this.loadUser();
          this.loadAssignableOrganizations();
        },
        error: (err) => {
          this.assigningOrganization.set(false);
          this.error.set(err?.error?.message || 'Unable to assign organization.');
        },
      });
  }

  async removeOrganizationMembership(organizationId: string): Promise<void> {
    const membershipOrganizationId = String(organizationId || '').trim();
    if (!membershipOrganizationId) {
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Organization',
      message: 'Remove this organization membership from the user?',
      confirmText: 'Remove',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-building-dash',
    });
    if (!confirmed) {
      return;
    }

    this.removingOrganizationId.set(membershipOrganizationId);
    this.error.set('');
    this.message.set('');
    this.api.remove(`/api/v1/users/${this.userId}/organizations`, membershipOrganizationId).subscribe({
      next: (response) => {
        this.removingOrganizationId.set('');
        this.message.set(response.message || 'Organization removed successfully.');
        this.loadUser();
        this.loadAssignableOrganizations();
      },
      error: (err) => {
        this.removingOrganizationId.set('');
        this.error.set(err?.error?.message || 'Unable to remove organization.');
      },
    });
  }

  private buildPayload(form: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      organizationId: this.optionalString(form['organizationId']),
      firstName: this.asString(form['firstName']),
      lastName: this.asString(form['lastName']),
      email: this.asString(form['email']).toLowerCase(),
      phone: this.optionalString(form['phone']),
      addressLine1: this.optionalString(form['addressLine1']),
      addressLine2: this.optionalString(form['addressLine2']),
      city: this.optionalString(form['city']),
      state: this.optionalString(form['state']),
      postalCode: this.optionalString(form['postalCode']),
      country: this.optionalString(form['country']),
      role: this.optionalString(form['role']),
      status: this.optionalString(form['status']),
      isEmailVerified: Boolean(form['isEmailVerified']),
      isActive: Boolean(form['isActive']),
    };

    const password = this.optionalString(form['password']);
    if (password) {
      payload['password'] = password;
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
}
