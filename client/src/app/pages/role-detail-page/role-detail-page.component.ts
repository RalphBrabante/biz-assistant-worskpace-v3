import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';

interface PermissionRow {
  id: string;
  name?: string;
  code?: string;
  resource?: string;
  action?: string;
  description?: string;
  isActive?: boolean;
  RolePermission?: {
    id?: string;
    isAllowed?: boolean;
    isActive?: boolean;
    createdAt?: string;
  };
}

interface RoleDetail {
  id: string;
  name?: string;
  code?: string;
  description?: string;
  isSystem?: boolean;
  isActive?: boolean;
  permissions?: PermissionRow[];
}

@Component({
  selector: 'app-role-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './role-detail-page.component.html',
})
export class RoleDetailPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly assigning = signal(false);
  readonly removingPermissionId = signal('');

  readonly message = signal('');
  readonly error = signal('');

  readonly role = signal<RoleDetail | null>(null);
  readonly assignablePermissions = signal<PermissionRow[]>([]);

  selectedPermissionId = '';
  form: Record<string, unknown> = {};

  get roleId(): string {
    return String(this.route.snapshot.paramMap.get('id') || '').trim();
  }

  ngOnInit(): void {
    if (!this.roleId) {
      this.error.set('Role id is required.');
      return;
    }

    this.loadRole();
    this.loadAssignablePermissions();
  }

  loadRole(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<RoleDetail>(`/api/v1/roles/${this.roleId}`).subscribe({
      next: (response: ApiResponse<RoleDetail>) => {
        this.loading.set(false);
        const role = response.data || null;
        this.role.set(role);
        this.form = {
          name: role?.name || '',
          code: role?.code || '',
          description: role?.description || '',
          isSystem: role?.isSystem === true,
          isActive: role?.isActive !== false,
        };
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load role details.');
      },
    });
  }

  loadAssignablePermissions(): void {
    this.api
      .list<PermissionRow>(`/api/v1/roles/${this.roleId}/assignable-permissions`)
      .subscribe({
        next: (response: ApiResponse<PermissionRow[]>) => {
          this.assignablePermissions.set(response.data || []);
        },
        error: () => {
          this.assignablePermissions.set([]);
        },
      });
  }

  async saveRole(): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Role',
      message: 'Save changes to this role?',
      confirmText: 'Update Role',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    const payload = {
      name: String(this.form['name'] || '').trim(),
      code: String(this.form['code'] || '').trim().toLowerCase(),
      description: String(this.form['description'] || '').trim() || undefined,
      isSystem: Boolean(this.form['isSystem']),
      isActive: Boolean(this.form['isActive']),
    };

    this.api.update<RoleDetail>('/api/v1/roles', this.roleId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Role updated successfully.');
        this.loadRole();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update role.');
      },
    });
  }

  assignPermission(): void {
    if (!this.selectedPermissionId.trim()) {
      this.error.set('Please select a permission to assign.');
      return;
    }

    this.assigning.set(true);
    this.error.set('');
    this.message.set('');

    this.api
      .create(`/api/v1/roles/${this.roleId}/permissions`, {
        permissionId: this.selectedPermissionId.trim(),
      })
      .subscribe({
        next: (response) => {
          this.assigning.set(false);
          this.message.set(response.message || 'Permission assigned successfully.');
          this.selectedPermissionId = '';
          this.loadRole();
        },
        error: (err) => {
          this.assigning.set(false);
          this.error.set(err?.error?.message || 'Unable to assign permission.');
        },
      });
  }

  async removePermission(permissionId: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Permission',
      message: 'Remove this permission from the role?',
      confirmText: 'Remove Permission',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-key',
    });
    if (!confirmed) {
      return;
    }
    this.removingPermissionId.set(permissionId);
    this.error.set('');
    this.message.set('');

    this.api.remove(`/api/v1/roles/${this.roleId}/permissions`, permissionId).subscribe({
      next: (response) => {
        this.removingPermissionId.set('');
        this.message.set(response.message || 'Permission removed successfully.');
        this.loadRole();
      },
      error: (err) => {
        this.removingPermissionId.set('');
        this.error.set(err?.error?.message || 'Unable to remove permission.');
      },
    });
  }

  trackByPermissionId(_index: number, permission: PermissionRow): string {
    return permission.id;
  }
}
