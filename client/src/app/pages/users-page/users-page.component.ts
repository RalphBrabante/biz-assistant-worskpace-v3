import {RowActionsComponent} from '../../shared/row-actions.component';
import { CountrySelectComponent } from '../../shared/country-select.component';
import { getBrowserCountry } from '../../shared/countries';
import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of, Subscription, timer, map, distinctUntilChanged, switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface UserRow {
  id: string;
  canManageAccount?: boolean;
  organizationId?: string;
  primaryOrganization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  role?: string;
  status?: string;
  isEmailVerified?: boolean;
  emailVerifiedAt?: string;
  isActive?: boolean;
  lastLoginAt?: string;
}

interface UserCreateResponse extends UserRow {
  inviteEmail?: {
    sent?: boolean;
    message?: string;
  };
}

interface ExistingUserSuggestion {
  id: string; firstName: string; lastName: string; email: string;
  alreadyAssigned: boolean; canAssign: boolean; inactiveMembership: boolean; membershipRole?: string;
}
const ORGANIZATION_ROLES = ['administrator', 'enduser', 'accountant', 'inventorymanager'];

interface RoleOption {
  id: string;
  name?: string;
  code?: string;
  description?: string;
}

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [RowActionsComponent, CountrySelectComponent, ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './users-page.component.html',
})
export class UsersPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly fb = inject(FormBuilder);

  constructor(api: ApiService, auth: AuthService) {
    this.api = api;
    this.auth = auth;
  }

  readonly rows = signal<UserRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly deactivatingId = signal('');
  private accountActionPending = false;
  readonly isCreateModalOpen = signal(false);
  readonly createOptionsLoading = signal(false);
  readonly createRoleOptions = signal<RoleOption[]>([]);
  readonly createOrganizationOptions = signal<OrganizationOption[]>([]);
  readonly createModalError = signal('');
  readonly existingUser = signal<ExistingUserSuggestion | null>(null);
  readonly emailLookupLoading = signal(false);
  readonly emailLookupError = signal('');
  existingRoleId = '';
  private formChangesSub?: Subscription;
  private emailLookupSub?: Subscription;
  private createOptionsSub?: Subscription;
  private lookupGeneration = 0;

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  readonly pageSizeOptions = [10, 20, 50, 100];
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
    viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'users-page';

  createUserForm: FormGroup = this.newCreateUserForm();
  createSelectedRoleIds: string[] = [];

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        String(row.firstName || '').toLowerCase().includes(q) ||
        String(row.lastName || '').toLowerCase().includes(q) ||
        String(row.email || '').toLowerCase().includes(q) ||
        String(row.role || '').toLowerCase().includes(q) ||
        String(row.status || '').toLowerCase().includes(q)
      );
    });
  });

  get currentOrganizationId(): string {
    return this.auth.currentUser()?.organizationId || '';
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get canAssignExistingUser(): boolean {
    return (this.auth.currentUser()?.roleCodes || []).some(code => ['administrator', 'superuser'].includes(code.toLowerCase()));
  }

  get existingRoleOptions(): RoleOption[] {
    return this.createRoleOptions().filter(role => ORGANIZATION_ROLES.includes(String(role.code).toLowerCase()));
  }

  get createOrganizationId(): string {
    return this.isSuperuser ? this.asString(this.createUserForm.getRawValue()['organizationId']) : this.currentOrganizationId;
  }

  get createOrganizationName(): string {
    const org = this.createOrganizationOptions().find(row => row.id === this.createOrganizationId);
    return org ? this.organizationOptionLabel(org) : this.auth.currentUser()?.organizationName || this.createOrganizationId;
  }

  ngOnDestroy(): void {
    this.formChangesSub?.unsubscribe(); this.emailLookupSub?.unsubscribe(); this.createOptionsSub?.unsubscribe();
    this.lookupGeneration++;
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.load();
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

    this.api.list<UserRow>(`/api/v1/users?${params.toString()}`).subscribe({
      next: (response: ApiResponse<UserRow[]>) => {
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
        this.error.set(err?.error?.message || 'Unable to load users.');
      },
    });
  }

  openCreateModal(): void {
    if (this.submitting()) return;
    this.closeCreateModal();
    this.createUserForm = this.newCreateUserForm();
    this.createSelectedRoleIds = [];
    this.createUserForm.patchValue({
      organizationId: this.isSuperuser ? this.organizationContext.getActiveOrganizationId() : this.currentOrganizationId,
    });
    this.createModalError.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
    this.formChangesSub = this.createUserForm.valueChanges.pipe(
      map(() => `${this.asString(this.createUserForm.getRawValue()['email']).toLowerCase()}|${this.createOrganizationId}`),
      distinctUntilChanged(),
    ).subscribe(() => this.checkExistingEmail());
    this.loadCreateModalOptions();
  }

  closeCreateModal(): void {
    if (this.submitting()) return;
    this.formChangesSub?.unsubscribe(); this.emailLookupSub?.unsubscribe(); this.createOptionsSub?.unsubscribe();
    this.lookupGeneration++;
    this.existingUser.set(null); this.existingRoleId = '';
    this.emailLookupLoading.set(false); this.emailLookupError.set('');
    this.isCreateModalOpen.set(false);
    this.createModalError.set('');
  }

  createUser(): void {
    if (this.submitting() || this.emailLookupLoading()) return;
    if (this.existingUser()) { this.assignExistingUser(); return; }
    if (this.emailLookupError()) { this.checkExistingEmail(true); return; }
    if (this.createUserForm.invalid) {
      this.createUserForm.markAllAsTouched();
      this.createModalError.set('Please complete all required user fields.');
      return;
    }

    if (!this.isSuperuser && !this.currentOrganizationId.trim()) {
      this.createModalError.set('Logged in user has no organization assigned.');
      return;
    }
    if (this.isSuperuser && !this.optionalString(this.createUserForm.getRawValue()['organizationId'])) {
      this.createModalError.set('Please select an organization.');
      return;
    }
    if (this.createSelectedRoleIds.length === 0) {
      this.createModalError.set('Please select at least one role.');
      return;
    }

    this.submitting.set(true);
    this.createModalError.set('');
    this.message.set('');

    const payload = this.buildPayload(this.createUserForm.getRawValue(), true);
    payload['organizationId'] = this.isSuperuser
      ? this.optionalString(this.createUserForm.getRawValue()['organizationId'])
      : this.currentOrganizationId;
    payload['roleIds'] = [...this.createSelectedRoleIds];
    delete payload['role'];

    this.api.create<UserCreateResponse>('/api/v1/users', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        const inviteEmail = response.data?.inviteEmail;
        const inviteSent = inviteEmail?.sent !== false;

        this.closeCreateModal();
        this.message.set(inviteSent
          ? response.message || 'User created successfully.'
          : inviteEmail?.message || 'User was created, but invite email could not be sent.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.createModalError.set(err?.error?.message || 'Unable to create user.');
        if (err?.status === 409 && this.canAssignExistingUser) this.checkExistingEmail(true);
      },
    });
  }

  checkExistingEmail(immediate = false): void {
    this.emailLookupSub?.unsubscribe();
    const generation = ++this.lookupGeneration;
    this.existingUser.set(null); this.existingRoleId = ''; this.emailLookupError.set(''); this.emailLookupLoading.set(false);
    const email = this.asString(this.createUserForm.getRawValue()['email']).toLowerCase();
    const organizationId = this.createOrganizationId;
    if (!this.isCreateModalOpen() || !this.canAssignExistingUser || !organizationId || this.createUserForm.get('email')?.invalid) return;
    this.emailLookupLoading.set(true);
    this.emailLookupSub = timer(immediate ? 0 : 350).pipe(
      switchMap(() => this.api.create<ExistingUserSuggestion | null>('/api/v1/users/lookup-email', { email, organizationId })),
    ).subscribe({
      next: response => {
        if (generation !== this.lookupGeneration || !this.isCreateModalOpen()) return;
        this.emailLookupLoading.set(false); this.existingUser.set(response.data || null);
        if (response.data) this.createModalError.set('');
        this.selectExistingRole();
      },
      error: err => {
        if (generation !== this.lookupGeneration) return;
        this.emailLookupLoading.set(false); this.emailLookupError.set(err?.error?.message || 'Unable to check this email. Retry the check.');
      },
    });
  }

  private selectExistingRole(): void {
    const existing = this.existingUser();
    if (existing?.inactiveMembership) this.existingRoleId = this.existingRoleOptions.find(role => role.code === existing.membershipRole)?.id || '';
  }

  assignExistingUser(): void {
    const existing = this.existingUser();
    if (this.submitting() || this.emailLookupLoading() || !existing?.canAssign || !this.canAssignExistingUser) return;
    const email = this.asString(this.createUserForm.getRawValue()['email']).toLowerCase();
    if (email !== existing.email.toLowerCase() || !this.createOrganizationId) { this.checkExistingEmail(true); return; }
    if (!this.existingRoleOptions.some(role => role.id === this.existingRoleId)) {
      this.createModalError.set('Select an organization role for this user.'); return;
    }
    this.submitting.set(true); this.createModalError.set('');
    this.api.create('/api/v1/users/assign-existing', { userId: existing.id, email, organizationId: this.createOrganizationId, roleId: this.existingRoleId }).subscribe({
      next: response => {
        this.submitting.set(false); this.closeCreateModal();
        this.message.set(response.message || 'Existing user assigned to organization.'); this.load();
      },
      error: err => {
        this.submitting.set(false); this.createModalError.set(err?.error?.message || 'Unable to assign this user.');
        if (err?.status === 409) this.checkExistingEmail(true);
      },
    });
  }

  canDeleteUser(row: UserRow): boolean {
    return row.canManageAccount !== false && row.isActive === false && this.auth.hasPermission('users.delete');
  }

  canDeactivateUser(row: UserRow): boolean {
    return this.isSuperuser && row.canManageAccount !== false && row.isActive === true;
  }

  async deactivateUser(id: string): Promise<void> {
    const row = this.rows().find(user => user.id === id);
    if (!row || !this.canDeactivateUser(row) || this.accountActionPending) return;
    this.accountActionPending = true;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Deactivate User',
      message: `Deactivate ${row.email}? This user will lose access. You can delete the account after deactivation.`,
      confirmText: 'Deactivate User',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-person-dash',
    });
    const current = this.rows().find(user => user.id === id);
    if (!confirmed || !current || !this.canDeactivateUser(current)) {
      this.accountActionPending = false;
      return;
    }
    this.deactivatingId.set(id);
    this.error.set('');
    this.message.set('');
    this.api.update<UserRow>('/api/v1/users', id, { isActive: false }).subscribe({
      next: (response) => {
        this.accountActionPending = false;
        this.deactivatingId.set('');
        this.message.set(response.message || 'User deactivated. The account can now be deleted.');
        this.load();
      },
      error: (err) => {
        this.accountActionPending = false;
        this.deactivatingId.set('');
        this.error.set(err?.error?.message || 'Unable to deactivate user.');
      },
    });
  }

  async removeUser(id: string): Promise<void> {
    const row = this.rows().find(user => user.id === id);
    if (!row || row.canManageAccount === false || this.accountActionPending) return;
    if (!this.canDeleteUser(row)) {
      if (row.isActive !== false) this.error.set('Deactivate this user before deleting the account.');
      return;
    }
    this.accountActionPending = true;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete User',
      message: `Delete ${row.email}? This action cannot be undone.`,
      confirmText: 'Delete User',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-person-x',
    });
    const current = this.rows().find(user => user.id === id);
    if (!confirmed || !current || !this.canDeleteUser(current)) {
      this.accountActionPending = false;
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/users', id).subscribe({
      next: (response) => {
        this.accountActionPending = false;
        this.deletingId.set('');
        this.message.set(response.message || 'User deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.accountActionPending = false;
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete user.');
      },
    });
  }

  setViewMode(mode: TableViewMode): void {
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

  trackById(_index: number, row: UserRow): string {
    return row.id;
  }

  loadCreateModalOptions(): void {
    this.createOptionsLoading.set(true);
    this.createRoleOptions.set([]);
    this.createOrganizationOptions.set([]);

    const rolesRequest = this.api.list<RoleOption>('/api/v1/roles?limit=500&isActive=true');
    const organizationsRequest = this.isSuperuser
      ? this.api.list<OrganizationOption>('/api/v1/organizations?limit=500')
      : of({ ok: true, data: [] } as ApiResponse<OrganizationOption[]>);

    this.createOptionsSub?.unsubscribe();
    this.createOptionsSub = forkJoin([rolesRequest, organizationsRequest]).subscribe({
      next: ([rolesResponse, organizationsResponse]: [ApiResponse<RoleOption[]>, ApiResponse<OrganizationOption[]>]) => {
        this.createOptionsLoading.set(false);
        const roleRows = (rolesResponse.data || []).filter(
          (role: RoleOption) =>
            this.isSuperuser || String(role.code || '').toLowerCase() !== 'superuser'
        );
        this.createRoleOptions.set(roleRows);
        this.createOrganizationOptions.set(organizationsResponse.data || []);
        this.selectExistingRole();
      },
      error: () => {
        this.createOptionsLoading.set(false);
        this.createModalError.set('Unable to load create-user options.');
      },
    });
  }

  organizationLabel(row: UserRow): string {
    if (row.primaryOrganization?.name) return row.primaryOrganization.name;
    if (row.primaryOrganization?.legalName) return row.primaryOrganization.legalName;
    return row.organizationId || '-';
  }

  userRoleBadgeClass(role: unknown): string {
    const normalized = String(role || '').toLowerCase();
    if (normalized.includes('superuser')) return 'ui-badge-dark';
    if (normalized.includes('administrator')) return 'ui-badge-primary';
    if (normalized.includes('accountant')) return 'ui-badge-info';
    if (normalized.includes('inventory')) return 'ui-badge-warning';
    return 'ui-badge-secondary';
  }

  userStatusBadgeClass(status: unknown): string {
    switch (String(status || '').toLowerCase()) {
      case 'active':
      case 'verified':
        return 'ui-badge-success';
      case 'pending_verification':
      case 'pending':
        return 'ui-badge-warning';
      case 'suspended':
      case 'disabled':
      case 'blocked':
        return 'ui-badge-danger';
      default:
        return 'ui-badge-secondary';
    }
  }

  verificationBadgeClass(isVerified: unknown): string {
    return isVerified ? 'ui-badge-success' : 'ui-badge-warning';
  }

  activeBadgeClass(isActive: unknown): string {
    return isActive === false ? 'ui-badge-secondary' : 'ui-badge-success';
  }

  generateCreatePassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    let generated = '';
    for (let i = 0; i < 12; i += 1) {
      generated += chars[Math.floor(Math.random() * chars.length)];
    }
    this.createUserForm.patchValue({ password: generated });
  }

  organizationOptionLabel(org: OrganizationOption): string {
    return org.name || org.legalName || org.id;
  }

  roleOptionLabel(role: RoleOption): string {
    return role.name || role.code || role.id;
  }

  isCreateRoleSelected(roleId: string): boolean {
    return this.createSelectedRoleIds.includes(roleId);
  }

  toggleCreateRoleSelection(roleId: string, checked: boolean): void {
    if (checked) {
      if (!this.createSelectedRoleIds.includes(roleId)) {
        this.createSelectedRoleIds = [...this.createSelectedRoleIds, roleId];
      }
      return;
    }
    this.createSelectedRoleIds = this.createSelectedRoleIds.filter((id) => id !== roleId);
  }

  private newUserForm(includePassword: boolean): Record<string, unknown> {
    return {
      organizationId: '',
      firstName: '',
      lastName: '',
      email: '',
      password: includePassword ? '' : '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: getBrowserCountry(),
      role: undefined,
      status: 'pending_verification',
      isEmailVerified: false,
      isActive: true,
    };
  }

  private newCreateUserForm(): FormGroup {
    const defaults = this.newUserForm(true);
    return this.fb.group({
      organizationId: [defaults['organizationId']],
      firstName: [defaults['firstName'], [Validators.required, Validators.maxLength(100)]],
      lastName: [defaults['lastName'], [Validators.required, Validators.maxLength(100)]],
      email: [defaults['email'], [Validators.required, Validators.email, Validators.maxLength(255)]],
      password: [defaults['password'], [Validators.required, Validators.minLength(8)]],
      phone: [defaults['phone'], [Validators.maxLength(30)]],
      addressLine1: [defaults['addressLine1'], [Validators.maxLength(255)]],
      addressLine2: [defaults['addressLine2'], [Validators.maxLength(255)]],
      city: [defaults['city'], [Validators.maxLength(100)]],
      state: [defaults['state'], [Validators.maxLength(100)]],
      postalCode: [defaults['postalCode'], [Validators.maxLength(20)]],
      country: [defaults['country'], [Validators.maxLength(100)]],
      role: [defaults['role']],
      status: [defaults['status'], [Validators.required]],
      isEmailVerified: [defaults['isEmailVerified']],
      isActive: [defaults['isActive']],
    });
  }

  private buildPayload(form: Record<string, unknown>, includePassword: boolean): Record<string, unknown> {
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
    if (includePassword || password) {
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
