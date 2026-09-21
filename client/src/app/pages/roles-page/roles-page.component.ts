import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';

interface RoleRow {
  id: string;
  name: string;
  code: string;
  description?: string;
  isSystem?: boolean;
  isActive?: boolean;
  createdAt?: string;
}

@Component({
  selector: 'app-roles-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './roles-page.component.html',
})
export class RolesPageComponent {
  private readonly api: ApiService;
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly fb = inject(FormBuilder);

  constructor(api: ApiService) {
    this.api = api;
  }

  readonly rows = signal<RoleRow[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly deletingId = signal('');
  readonly isCreateModalOpen = signal(false);

  readonly message = signal('');
  readonly error = signal('');
  readonly filter = signal('');
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'roles-page';

  createRoleForm: FormGroup = this.newCreateRoleForm();

  editingId = '';
  editForm: Record<string, unknown> = {
    name: '',
    code: '',
    description: '',
    isSystem: false,
    isActive: true,
  };

  readonly filteredRows = computed(() => {
    const q = this.filter().trim().toLowerCase();
    if (!q) {
      return this.rows();
    }

    return this.rows().filter((row) => {
      return (
        row.name?.toLowerCase().includes(q) ||
        row.code?.toLowerCase().includes(q) ||
        String(row.description || '').toLowerCase().includes(q)
      );
    });
  });

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.list<RoleRow>('/api/v1/roles').subscribe({
      next: (response: ApiResponse<RoleRow[]>) => {
        this.loading.set(false);
        this.rows.set(response.data || []);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load roles.');
      },
    });
  }

  openCreateModal(): void {
    this.createRoleForm = this.newCreateRoleForm();
    this.error.set('');
    this.message.set('');
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  createRole(): void {
    if (this.createRoleForm.invalid) {
      this.createRoleForm.markAllAsTouched();
      this.error.set('Please complete all required role fields.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');
    const value = this.createRoleForm.getRawValue();

    const payload = {
      name: String(value['name'] || '').trim(),
      code: String(value['code'] || '').trim().toLowerCase(),
      description: String(value['description'] || '').trim() || undefined,
      isSystem: Boolean(value['isSystem']),
      isActive: Boolean(value['isActive']),
    };

    this.api.create<RoleRow>('/api/v1/roles', payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.isCreateModalOpen.set(false);
        this.message.set(response.message || 'Role created successfully.');
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to create role.');
      },
    });
  }

  startEdit(row: RoleRow): void {
    this.editingId = row.id;
    this.editForm = {
      name: row.name || '',
      code: row.code || '',
      description: row.description || '',
      isSystem: Boolean(row.isSystem),
      isActive: row.isActive !== false,
    };
  }

  cancelEdit(): void {
    this.editingId = '';
  }

  async saveEdit(): Promise<void> {
    if (!this.editingId) {
      return;
    }
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
      name: String(this.editForm['name'] || '').trim(),
      code: String(this.editForm['code'] || '').trim().toLowerCase(),
      description: String(this.editForm['description'] || '').trim() || undefined,
      isSystem: Boolean(this.editForm['isSystem']),
      isActive: Boolean(this.editForm['isActive']),
    };

    this.api.update<RoleRow>('/api/v1/roles', this.editingId, payload).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.message.set(response.message || 'Role updated successfully.');
        this.editingId = '';
        this.load();
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to update role.');
      },
    });
  }

  async removeRole(id: string): Promise<void> {
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Role',
      message: 'Delete this role? This action cannot be undone.',
      confirmText: 'Delete Role',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-trash3',
    });
    if (!confirmed) {
      return;
    }
    this.deletingId.set(id);
    this.error.set('');
    this.message.set('');

    this.api.remove('/api/v1/roles', id).subscribe({
      next: (response) => {
        this.deletingId.set('');
        this.message.set(response.message || 'Role deleted successfully.');
        this.load();
      },
      error: (err) => {
        this.deletingId.set('');
        this.error.set(err?.error?.message || 'Unable to delete role.');
      },
    });
  }

  trackById(_index: number, row: RoleRow): string {
    return row.id;
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
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

  controlHasError(controlName: string, errorCode?: string): boolean {
    const control = this.createRoleForm.get(controlName);
    if (!control || !(control.touched || control.dirty)) {
      return false;
    }
    if (!errorCode) {
      return control.invalid;
    }
    return !!control.errors?.[errorCode];
  }

  private newCreateRoleForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      code: ['', [Validators.required, Validators.pattern(/^[a-z0-9_]+$/)]],
      description: ['', [Validators.maxLength(500)]],
      isSystem: [false],
      isActive: [true],
    });
  }
}
