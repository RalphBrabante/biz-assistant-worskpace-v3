import { CommonModule } from '@angular/common';
import { Component, OnDestroy, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription, concat, forkJoin, last } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { TableViewMode, loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode } from '../../core/table-preferences';
import { ModalDirective } from '../../shared/modal.directive';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { RowActionsComponent } from '../../shared/row-actions.component';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface PermissionOption { id: string; code: string; name?: string; resource: string; action: string; description?: string }
interface Person { id: string; firstName?: string; lastName?: string; email?: string }
interface MemberOption extends Person { roleIds: string[] }
interface RoleRow {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
  isSystem: boolean;
  presetCode: string | null;
  permissionsLocked: boolean;
  canReset: boolean;
  permissions: PermissionOption[];
  members: Person[];
  memberCount: number;
}
interface AuditEntry {
  id: string;
  action: string;
  roleName?: string;
  createdAt: string;
  actor: Person | null;
  targetUser: Person | null;
  details: { added?: string[]; removed?: string[]; from?: string; roles?: string[]; changes?: Record<string, { from: unknown; to: unknown }> } | null;
}
interface PermissionGroup { resource: string; label: string; permissions: PermissionOption[] }
interface RoleEditor { id: string; name: string; code: string; description: string; isActive: boolean; locked: boolean; isSystem: boolean; lockedNote: string }

const TYPE_LABELS: Record<string, string> = { system: 'System', custom: 'Custom' };
const STATUS_LABELS: Record<string, string> = { active: 'Active', disabled: 'Disabled' };
const ACTION_LABELS: Record<string, string> = {
  'role.created': 'Created role',
  'role.updated': 'Updated role',
  'role.deleted': 'Deleted role',
  'role.cloned': 'Copied role',
  'role.permissions_changed': 'Changed permissions',
  'role.reset_to_defaults': 'Reset to defaults',
  'member.role_assigned': 'Assigned role',
  'member.role_removed': 'Removed role',
  'member.removed': 'Removed from organization',
  'migration.catalogue_provisioned': 'Roles set up',
  'migration.member_backfilled': 'Member role moved to this organization',
  'migration.custom_role_renamed': 'Custom role renamed',
};

@Component({
  selector: 'app-organization-roles-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalDirective, OrganizationRequiredComponent, RowActionsComponent, TooltipDirective],
  templateUrl: './organization-roles-page.component.html',
})
export class OrganizationRolesPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  readonly organizations = inject(OrganizationContextService);

  private readonly tablePrefsKey = 'organization-roles-page';
  private listSub?: Subscription;
  private auditSub?: Subscription;
  private writes = new Subscription();

  readonly pageSizeOptions = [10, 20, 50];
  tab: 'roles' | 'activity' = 'roles';
  rows: RoleRow[] = [];
  permissionOptions: PermissionOption[] = [];
  memberOptions: MemberOption[] = [];
  loading = false;
  error = '';
  message = '';

  searchQuery = '';
  typeFilter = '';
  statusFilter = '';
  page = 1;
  pageSize = 20;
  viewMode: TableViewMode = 'table';

  editorOpen = false;
  editor: RoleEditor = this.emptyEditor();
  editorError = '';
  selectedPermissionIds = new Set<string>();
  codeEdited = false;
  touched = { name: false, code: false };

  membersRole: RoleRow | null = null;
  memberToAdd = '';
  membersError = '';

  copySource: RoleRow | null = null;
  copyName = '';
  copyCode = '';
  copyError = '';

  submitting = false;

  audit: AuditEntry[] = [];
  auditLoading = false;
  auditError = '';
  auditPage = 1;
  auditTotalPages = 1;
  auditTotal = 0;

  constructor() {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.pageSize = toPositiveInt(prefs['pageSize'], 20);
    this.viewMode = toTableViewMode(prefs['viewMode']);
    effect(() => {
      this.organizations.selectedOrganizationId();
      this.auth.currentUser();
      this.resetForOrganizationChange();
      if (this.organizationId) this.load();
    });
  }

  ngOnDestroy(): void {
    this.listSub?.unsubscribe();
    this.auditSub?.unsubscribe();
    this.writes.unsubscribe();
  }

  get organizationId(): string { return this.organizations.getActiveOrganizationId(); }

  private url(path = '', params = new URLSearchParams()): string {
    params.set('organizationId', this.organizationId);
    return `/api/v1/organization-roles${path}?${params}`;
  }

  private resetForOrganizationChange(): void {
    this.listSub?.unsubscribe();
    this.auditSub?.unsubscribe();
    this.writes.unsubscribe();
    this.writes = new Subscription();
    this.rows = [];
    this.permissionOptions = [];
    this.memberOptions = [];
    this.audit = [];
    this.editorOpen = false;
    this.membersRole = null;
    this.copySource = null;
    this.submitting = false;
    this.error = '';
    this.message = '';
    this.page = 1;
    this.auditPage = 1;
  }

  load(): void {
    this.listSub?.unsubscribe();
    this.loading = true;
    this.error = '';
    this.listSub = forkJoin([
      this.api.getFresh<RoleRow[]>(this.url()),
      this.api.getFresh<{ permissions: PermissionOption[]; members: MemberOption[] }>(this.url('/options')),
    ]).subscribe({
      next: ([roles, options]) => {
        this.loading = false;
        this.rows = roles.data || [];
        this.permissionOptions = options.data?.permissions || [];
        this.memberOptions = options.data?.members || [];
        if (this.membersRole) this.membersRole = this.rows.find((row) => row.id === this.membersRole?.id) || null;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Unable to load this organization’s roles.';
      },
    });
    if (this.tab === 'activity') this.loadAudit();
  }

  setTab(tab: 'roles' | 'activity'): void {
    this.tab = tab;
    if (tab === 'activity') this.loadAudit();
  }

  // ---- Filters

  get filteredRows(): RoleRow[] {
    const query = this.searchQuery.trim().toLowerCase();
    return this.rows.filter((row) =>
      (!query || `${row.name} ${row.code} ${row.description || ''}`.toLowerCase().includes(query))
      && (!this.typeFilter || (this.typeFilter === 'system') === row.isSystem)
      && (!this.statusFilter || (this.statusFilter === 'active') === row.isActive));
  }

  get totalPages(): number { return Math.max(Math.ceil(this.filteredRows.length / this.pageSize), 1); }

  get pagedRows(): RoleRow[] {
    const page = Math.min(this.page, this.totalPages);
    return this.filteredRows.slice((page - 1) * this.pageSize, page * this.pageSize);
  }

  get hasActiveFilters(): boolean { return Boolean(this.searchQuery.trim() || this.typeFilter || this.statusFilter); }

  get activeFilterCount(): number {
    return [this.searchQuery.trim(), this.typeFilter, this.statusFilter].filter(Boolean).length;
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.typeFilter = '';
    this.statusFilter = '';
    this.page = 1;
  }

  clearSearch(): void { this.searchQuery = ''; this.page = 1; }
  typeLabel(value: string): string { return TYPE_LABELS[value] || value; }
  statusLabel(value: string): string { return STATUS_LABELS[value] || value; }

  onPageSizeChange(value: number | string): void {
    this.pageSize = toPositiveInt(value, 20);
    this.page = 1;
    saveTablePreferences(this.tablePrefsKey, { pageSize: this.pageSize });
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    saveTablePreferences(this.tablePrefsKey, { viewMode: mode });
  }

  trackById(_index: number, row: { id: string }): string { return row.id; }
  trackByGroup(_index: number, group: PermissionGroup): string { return group.resource; }

  // ---- Create and edit

  private emptyEditor(): RoleEditor {
    return { id: '', name: '', code: '', description: '', isActive: true, locked: false, isSystem: false, lockedNote: '' };
  }

  openCreate(): void {
    this.editor = this.emptyEditor();
    this.selectedPermissionIds = new Set();
    this.editorError = '';
    this.codeEdited = false;
    this.touched = { name: false, code: false };
    this.message = '';
    this.editorOpen = true;
  }

  openEdit(row: RoleRow): void {
    this.editor = {
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description || '',
      isActive: row.isActive,
      locked: row.permissionsLocked,
      isSystem: row.isSystem,
      lockedNote: row.presetCode === 'administrator'
        ? 'Administrators always have full access to their organization, so this role’s permissions cannot be changed.'
        : row.presetCode === 'accountant'
          ? 'The Accountant role has fixed read-only access, so its permissions cannot be changed.'
          : '',
    };
    this.selectedPermissionIds = new Set(row.permissions.map((permission) => permission.id));
    this.editorError = '';
    this.codeEdited = true;
    this.touched = { name: false, code: false };
    this.message = '';
    this.editorOpen = true;
  }

  closeEditor(): void { if (!this.submitting) this.editorOpen = false; }

  onNameChange(value: string): void {
    this.editor.name = value;
    if (!this.editor.id && !this.codeEdited) this.editor.code = this.codeFromName(value);
  }

  onCodeChange(value: string): void {
    this.editor.code = value;
    this.codeEdited = true;
  }

  codeFromName(name: string): string {
    return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 100);
  }

  nameError(value: string = this.editor.name): string {
    const name = String(value || '').trim();
    if (!name) return 'Enter a role name.';
    return name.length > 100 ? 'Keep the name under 100 characters.' : '';
  }

  codeError(value: string = this.editor.code): string {
    if (this.editor.isSystem) return '';
    return /^[a-z][a-z0-9_]{0,99}$/.test(String(value || '').trim())
      ? ''
      : 'Start with a letter, then use lowercase letters, numbers and underscores.';
  }

  get permissionGroups(): PermissionGroup[] {
    const groups = new Map<string, PermissionGroup>();
    for (const permission of this.permissionOptions) {
      if (!groups.has(permission.resource)) {
        groups.set(permission.resource, { resource: permission.resource, label: this.titleCase(permission.resource), permissions: [] });
      }
      groups.get(permission.resource)!.permissions.push(permission);
    }
    return [...groups.values()];
  }

  titleCase(value: string): string {
    return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  togglePermission(id: string, checked: boolean): void {
    if (checked) this.selectedPermissionIds.add(id);
    else this.selectedPermissionIds.delete(id);
  }

  isGroupSelected(group: PermissionGroup): boolean {
    return group.permissions.every((permission) => this.selectedPermissionIds.has(permission.id));
  }

  toggleGroup(group: PermissionGroup, checked: boolean): void {
    for (const permission of group.permissions) this.togglePermission(permission.id, checked);
  }

  saveEditor(): void {
    this.touched = { name: true, code: true };
    if (this.submitting || this.nameError() || this.codeError()) return;
    const details: Record<string, unknown> = { name: this.editor.name.trim(), description: this.editor.description.trim() };
    if (!this.editor.isSystem) {
      details['code'] = this.editor.code.trim();
      details['isActive'] = this.editor.isActive;
    }
    const permissionIds = [...this.selectedPermissionIds];
    this.submitting = true;
    this.editorError = '';
    let request: Observable<unknown>;
    if (!this.editor.id) {
      request = this.api.create(this.url(), { ...details, permissionIds });
    } else {
      const steps: Observable<unknown>[] = [this.api.put(this.url(`/${this.editor.id}`), details)];
      if (!this.editor.locked) steps.push(this.api.put(this.url(`/${this.editor.id}/permissions`), { permissionIds }));
      request = concat(...steps).pipe(last());
    }
    const wasNew = !this.editor.id;
    this.writes.add(request.subscribe({
      next: () => {
        this.submitting = false;
        this.editorOpen = false;
        this.message = wasNew ? 'Role created.' : 'Role updated.';
        this.load();
      },
      error: (err) => {
        this.submitting = false;
        this.editorError = err?.error?.message || 'Unable to save this role.';
      },
    }));
  }

  // ---- Row actions

  async toggleActive(row: RoleRow): Promise<void> {
    if (row.isActive) {
      const confirmed = await this.confirmDialog.confirm({
        title: 'Disable role',
        message: `${row.memberCount} member${row.memberCount === 1 ? '' : 's'} will immediately lose the permissions this role gives them.`,
        confirmText: 'Disable role',
        iconClass: 'bi-slash-circle',
      });
      if (!confirmed) return;
    }
    this.runAction(this.api.put(this.url(`/${row.id}`), {
      name: row.name, code: row.code, description: row.description || '', isActive: !row.isActive,
    }), row.isActive ? 'Role disabled.' : 'Role enabled.');
  }

  async resetRole(row: RoleRow): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Reset to defaults',
      message: `Replace ${row.name}’s permissions with the defaults for new organizations. Members’ access changes immediately.`,
      confirmText: 'Reset role',
      iconClass: 'bi-arrow-counterclockwise',
    });
    if (confirmed) this.runAction(this.api.create(this.url(`/${row.id}/reset`), {}), 'Role reset to its defaults.');
  }

  async deleteRole(row: RoleRow): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete role',
      message: `Delete ${row.name}? This cannot be undone.`,
      confirmText: 'Delete role',
      iconClass: 'bi-trash',
    });
    if (!confirmed) return;
    const params = new URLSearchParams({ organizationId: this.organizationId });
    this.runAction(this.api.remove('/api/v1/organization-roles', `${row.id}?${params}`), 'Role deleted.');
  }

  private runAction(request: Observable<unknown>, success: string): void {
    this.error = '';
    this.message = '';
    this.writes.add(request.subscribe({
      next: () => { this.message = success; this.load(); },
      error: (err) => { this.error = err?.error?.message || 'Unable to complete this action.'; },
    }));
  }

  // ---- Copy

  openCopy(row: RoleRow): void {
    this.copySource = row;
    this.copyName = `${row.name} copy`;
    this.copyCode = this.codeFromName(this.copyName);
    this.copyError = '';
  }

  closeCopy(): void { if (!this.submitting) this.copySource = null; }

  saveCopy(): void {
    const source = this.copySource;
    if (!source || this.submitting) return;
    if (this.nameError(this.copyName)) { this.copyError = this.nameError(this.copyName); return; }
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(this.copyCode.trim())) { this.copyError = 'Start the code with a letter, then use lowercase letters, numbers and underscores.'; return; }
    this.submitting = true;
    this.copyError = '';
    this.writes.add(this.api.create(this.url(`/${source.id}/clone`), { name: this.copyName.trim(), code: this.copyCode.trim() }).subscribe({
      next: () => {
        this.submitting = false;
        this.copySource = null;
        this.message = 'Role copied.';
        this.load();
      },
      error: (err) => {
        this.submitting = false;
        this.copyError = err?.error?.message || 'Unable to copy this role.';
      },
    }));
  }

  // ---- Members

  openMembers(row: RoleRow): void {
    this.membersRole = row;
    this.memberToAdd = '';
    this.membersError = '';
  }

  closeMembers(): void { if (!this.submitting) this.membersRole = null; }

  get availableMembers(): MemberOption[] {
    const role = this.membersRole;
    if (!role) return [];
    const current = new Set(role.members.map((member) => member.id));
    return this.memberOptions.filter((member) => !current.has(member.id));
  }

  personName(person: Person | null | undefined): string {
    if (!person) return 'System';
    return [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || person.id;
  }

  addMember(): void {
    const role = this.membersRole;
    if (!role || !this.memberToAdd || this.submitting) return;
    this.memberAction(this.api.create(this.url(`/${role.id}/members`), { userId: this.memberToAdd }));
    this.memberToAdd = '';
  }

  removeMember(member: Person): void {
    const role = this.membersRole;
    if (!role || this.submitting) return;
    const params = new URLSearchParams({ organizationId: this.organizationId });
    this.memberAction(this.api.remove(`/api/v1/organization-roles/${role.id}/members`, `${member.id}?${params}`));
  }

  private memberAction(request: Observable<unknown>): void {
    this.submitting = true;
    this.membersError = '';
    this.writes.add(request.subscribe({
      next: () => { this.submitting = false; this.load(); },
      error: (err) => {
        this.submitting = false;
        this.membersError = err?.error?.message || 'Unable to update this role’s members.';
      },
    }));
  }

  // ---- Activity

  loadAudit(delta = 0): void {
    const next = this.auditPage + delta;
    if (next < 1 || next > this.auditTotalPages) return;
    this.auditSub?.unsubscribe();
    this.auditPage = next;
    this.auditLoading = true;
    this.auditError = '';
    const params = new URLSearchParams({ page: String(this.auditPage), limit: '20' });
    this.auditSub = this.api.getFresh<AuditEntry[]>(this.url('/audit', params)).subscribe({
      next: (response) => {
        this.auditLoading = false;
        this.audit = response.data || [];
        this.auditTotal = response.meta?.total || 0;
        this.auditTotalPages = response.meta?.totalPages || 1;
      },
      error: (err) => {
        this.auditLoading = false;
        this.auditError = err?.error?.message || 'Unable to load role activity.';
      },
    });
  }

  actionLabel(entry: AuditEntry): string { return ACTION_LABELS[entry.action] || this.titleCase(entry.action); }

  auditSummary(entry: AuditEntry): string {
    const parts: string[] = [];
    if (entry.targetUser) parts.push(this.personName(entry.targetUser));
    if (entry.details?.from) parts.push(`from ${entry.details.from}`);
    if (entry.details?.roles?.length) parts.push(`held ${entry.details.roles.join(', ')}`);
    if (entry.details?.added?.length) parts.push(`added ${entry.details.added.join(', ')}`);
    if (entry.details?.removed?.length) parts.push(`removed ${entry.details.removed.join(', ')}`);
    const changes = Object.keys(entry.details?.changes || {});
    if (changes.length) parts.push(`changed ${changes.join(', ')}`);
    return parts.join(' · ');
  }
}
