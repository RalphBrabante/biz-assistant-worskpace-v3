import { CountrySelectComponent } from '../../shared/country-select.component';
import { getBrowserCountry } from '../../shared/countries';
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse, CrudResourceConfig, FieldConfig } from '../../core/types';
import { loadTablePreferences, saveTablePreferences, toTableViewMode, TableViewMode } from '../../core/table-preferences';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { RESOURCE_CONFIGS } from '../../shared/resource-configs';

@Component({
  selector: 'app-resource-page',
  standalone: true,
  imports: [CountrySelectComponent, CommonModule, FormsModule, TooltipDirective],
  templateUrl: './resource-page.component.html',
})
export class ResourcePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly config = this.resolveConfig();

  rows: Record<string, unknown>[] = [];
  loading = false;
  submitting = false;
  deletingId = '';

  form: Record<string, unknown> = this.makeInitialForm();
  editingId = '';

  message = '';
  error = '';
  searchQuery = '';
  activeFilter = '';
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'resource-page';

  ngOnInit(): void {
    this.restoreTablePreferences();
    this.load();
  }

  isCheckbox(field: FieldConfig): boolean {
    return field.type === 'checkbox';
  }

  isTextArea(field: FieldConfig): boolean {
    return field.type === 'textarea';
  }

  isJson(field: FieldConfig): boolean {
    return field.type === 'json';
  }

  inputType(field: FieldConfig): string {
    return field.type || 'text';
  }

  load(): void {
    this.loading = true;
    this.error = '';

    this.api.list<Record<string, unknown>>(this.config.endpoint).subscribe({
      next: (response: ApiResponse<Record<string, unknown>[]>) => {
        this.loading = false;
        this.rows = response.data || [];
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || `Unable to load ${this.config.title.toLowerCase()}.`;
      },
    });
  }

  edit(row: Record<string, unknown>): void {
    this.editingId = String(row['id'] || '');
    const nextForm = this.makeInitialForm();

    for (const field of this.config.fields) {
      const raw = row[field.key];
      if (raw === undefined || raw === null) {
        continue;
      }

      if (field.type === 'json') {
        nextForm[field.key] = JSON.stringify(raw, null, 2);
      } else if (field.type === 'datetime-local') {
        nextForm[field.key] = this.toDateTimeLocal(raw);
      } else if (field.type === 'date') {
        nextForm[field.key] = String(raw).slice(0, 10);
      } else {
        nextForm[field.key] = raw;
      }
    }

    this.form = nextForm;
  }

  cancelEdit(): void {
    this.editingId = '';
    this.form = this.makeInitialForm();
  }

  async submit(): Promise<void> {
    if (this.editingId) {
      const confirmed = await this.confirmDialog.confirm({
        title: `Update ${this.config.title}`,
        message: `Save changes to this ${this.config.title.toLowerCase()}?`,
        confirmText: 'Update',
        confirmButtonClass: 'ui-btn-primary',
        iconClass: 'bi-pencil-square',
      });
      if (!confirmed) {
        return;
      }
    }

    this.submitting = true;
    this.error = '';
    this.message = '';

    const payload = this.toPayload();

    const request = this.editingId
      ? this.api.update<Record<string, unknown>>(this.config.endpoint, this.editingId, payload)
      : this.api.create<Record<string, unknown>>(this.config.endpoint, payload);

    request.subscribe({
      next: (response: ApiResponse<Record<string, unknown>>) => {
        this.submitting = false;
        this.message = response.message || `${this.config.title} saved.`;
        this.cancelEdit();
        this.load();
      },
      error: (err) => {
        this.submitting = false;
        this.error = err?.error?.message || `Unable to save ${this.config.title.toLowerCase()}.`;
      },
    });
  }

  async remove(id: unknown): Promise<void> {
    const normalizedId = String(id || '');
    if (!normalizedId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: `Delete ${this.config.title}`,
      message: `Delete this ${this.config.title.toLowerCase()}? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-trash3',
    });
    if (!confirmed) {
      return;
    }

    this.deletingId = normalizedId;
    this.error = '';
    this.message = '';

    this.api.remove(this.config.endpoint, normalizedId).subscribe({
      next: (response) => {
        this.deletingId = '';
        this.message = response.message || `${this.config.title} deleted.`;
        this.load();
      },
      error: (err) => {
        this.deletingId = '';
        this.error = err?.error?.message || `Unable to delete ${this.config.title.toLowerCase()}.`;
      },
    });
  }

  trackById(_index: number, row: Record<string, unknown>): unknown {
    return row['id'] || _index;
  }

  setViewMode(mode: TableViewMode): void {
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  prettyValue(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    return String(value);
  }

  get filteredRows(): Record<string, unknown>[] {
    const q = this.searchQuery.trim().toLowerCase();

    return this.rows.filter((row) => {
      if (this.activeFilter === 'active' && row['isActive'] !== true) {
        return false;
      }
      if (this.activeFilter === 'inactive' && row['isActive'] !== false) {
        return false;
      }

      if (!q) {
        return true;
      }

      const summaryMatch = this.config.summaryFields.some((key) =>
        String(row[key] ?? '')
          .toLowerCase()
          .includes(q)
      );

      return summaryMatch || String(row['id'] ?? '').toLowerCase().includes(q);
    });
  }

  private resolveConfig(): CrudResourceConfig {
    const key = String(this.route.snapshot.data['resourceKey'] || '');
    const config = RESOURCE_CONFIGS[key];
    if (!config) {
      return {
        title: 'Resource',
        endpoint: '/api/v1',
        summaryFields: [],
        fields: [],
      };
    }
    return config;
  }

  private makeInitialForm(): Record<string, unknown> {
    const initial: Record<string, unknown> = { ...(this.config.createDefaults || {}) };

    for (const field of this.config.fields) {
      if (field.key === 'country') initial[field.key] = getBrowserCountry();
      if (field.type === 'checkbox' && initial[field.key] === undefined) {
        initial[field.key] = false;
      }
      if (field.type === 'json' && initial[field.key] === undefined) {
        initial[field.key] = '{}';
      }
    }

    return initial;
  }

  private toPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const field of this.config.fields) {
      const raw = this.form[field.key];

      if (field.type === 'checkbox') {
        payload[field.key] = Boolean(raw);
        continue;
      }

      if (raw === undefined || raw === null || raw === '') {
        continue;
      }

      if (field.type === 'number') {
        payload[field.key] = Number(raw);
        continue;
      }

      if (field.type === 'json') {
        payload[field.key] = this.safeJsonParse(String(raw));
        continue;
      }

      payload[field.key] = raw;
    }

    return payload;
  }

  private safeJsonParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private toDateTimeLocal(value: unknown): string {
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

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      viewMode: this.viewMode,
    });
  }
}
