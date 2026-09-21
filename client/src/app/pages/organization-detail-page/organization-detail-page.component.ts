import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';

interface Organization {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  contactEmail?: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  isActive?: boolean;
}

interface UserMembership {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
  OrganizationUser?: {
    id?: string;
    role?: string;
    isActive?: boolean;
  };
}

interface UserOption {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  organizationId?: string;
}

interface RoleOption {
  id: string;
  name: string;
  code: string;
  description?: string;
}

@Component({
  selector: 'app-organization-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './organization-detail-page.component.html',
})
export class OrganizationDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  organizationId = '';
  organization: Organization | null = null;
  members: UserMembership[] = [];

  userSearchQuery = '';
  userOptions: UserOption[] = [];
  selectedUserId = '';
  roleOptions: RoleOption[] = [];
  selectedRoleId = '';

  loading = false;
  memberLoading = false;
  searchingUsers = false;
  assigningUser = false;
  removingUserId = '';

  error = '';
  message = '';

  ngOnInit(): void {
    this.organizationId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.organizationId) {
      this.error = 'Organization ID is missing.';
      return;
    }

    this.loadAll();
  }

  loadAll(): void {
    this.loadOrganization();
    this.loadMembers();
    this.loadAssignableRoles();
  }

  loadOrganization(): void {
    this.loading = true;
    this.error = '';

    this.api.get<Organization>(`/api/v1/organizations/${this.organizationId}`).subscribe({
      next: (response: ApiResponse<Organization>) => {
        this.loading = false;
        this.organization = response.data || null;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Unable to load organization details.';
      },
    });
  }

  loadMembers(): void {
    this.memberLoading = true;

    this.api.list<UserMembership>(`/api/v1/organizations/${this.organizationId}/users`).subscribe({
      next: (response: ApiResponse<UserMembership[]>) => {
        this.memberLoading = false;
        this.members = response.data || [];
      },
      error: (err) => {
        this.memberLoading = false;
        this.error = err?.error?.message || 'Unable to load organization members.';
      },
    });
  }

  searchUsers(): void {
    const q = this.userSearchQuery.trim();
    this.searchingUsers = true;
    const endpoint = `/api/v1/organizations/${this.organizationId}/assignable-users?q=${encodeURIComponent(q)}&limit=30`;

    this.api.list<UserOption>(endpoint).subscribe({
      next: (response: ApiResponse<UserOption[]>) => {
        this.searchingUsers = false;
        this.userOptions = response.data || [];
      },
      error: (err) => {
        this.searchingUsers = false;
        this.error = err?.error?.message || 'Unable to search users.';
      },
    });
  }

  loadAssignableRoles(): void {
    this.api.list<RoleOption>(`/api/v1/organizations/${this.organizationId}/assignable-roles`).subscribe({
      next: (response: ApiResponse<RoleOption[]>) => {
        this.roleOptions = response.data || [];
        if (!this.selectedRoleId && this.roleOptions.length > 0) {
          this.selectedRoleId = this.roleOptions[0].id;
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load role options.';
      },
    });
  }

  addMember(): void {
    const userId = this.selectedUserId.trim();
    if (!userId) {
      this.error = 'Select a user first.';
      return;
    }

    this.assigningUser = true;
    this.error = '';
    this.message = '';

    this.api
      .create(`/api/v1/organizations/${this.organizationId}/users`, {
        userId,
        roleId: this.selectedRoleId || undefined,
        isActive: true,
      })
      .subscribe({
        next: () => {
          this.assigningUser = false;
          this.message = 'User added to organization.';
          this.selectedUserId = '';
          this.userOptions = [];
          this.userSearchQuery = '';
          this.loadMembers();
        },
        error: (err) => {
          this.assigningUser = false;
          this.error = err?.error?.message || 'Unable to add user to organization.';
        },
      });
  }

  async removeMember(userId: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Member',
      message: 'Remove this user from the organization?',
      confirmText: 'Remove User',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-person-dash',
    });
    if (!confirmed) {
      return;
    }
    this.removingUserId = userId;
    this.error = '';
    this.message = '';

    this.api.remove(`/api/v1/organizations/${this.organizationId}/users`, userId).subscribe({
      next: () => {
        this.removingUserId = '';
        this.message = 'User removed from organization.';
        this.loadMembers();
      },
      error: (err) => {
        this.removingUserId = '';
        this.error = err?.error?.message || 'Unable to remove user from organization.';
      },
    });
  }

  memberRole(member: UserMembership): string {
    return member.OrganizationUser?.role || 'member';
  }

  memberActive(member: UserMembership): boolean {
    if (member.OrganizationUser?.isActive !== undefined) {
      return Boolean(member.OrganizationUser.isActive);
    }
    return member.isActive !== false;
  }

  userLabel(user: UserOption): string {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return name ? `${name} (${user.email || user.id})` : user.email || user.id;
  }

  roleLabel(role: RoleOption): string {
    return role.name ? `${role.name} (${role.code})` : role.code;
  }

  trackByUserOptionId(index: number, row: UserOption): string {
    return row.id || String(index);
  }

  trackByRoleOptionId(index: number, row: RoleOption): string {
    return row.id || String(index);
  }

  trackByMemberId(index: number, row: UserMembership): string {
    return row.id || String(index);
  }
}
