import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ApiResponse } from '../core/types';
import { ModalDirective } from './modal.directive';
import { TooltipDirective } from './tooltip.directive';
import { EXTENSION_PRESETS, LicenseRow, licenseState, organizationLabel, previewExtension } from './license-utils';

export interface LicenseExtendedEvent {
  license: LicenseRow;
  message: string;
  warnings: string[];
}

/** Renews a license by a preset term or to a chosen date. The API decides the final date. */
@Component({
  selector: 'app-license-extend-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalDirective, TooltipDirective],
  templateUrl: './license-extend-dialog.component.html',
})
export class LicenseExtendDialogComponent {
  private readonly api = inject(ApiService);

  @Input({ required: true }) license!: LicenseRow;
  @Output() closed = new EventEmitter<void>();
  @Output() extended = new EventEmitter<LicenseExtendedEvent>();

  readonly presets = EXTENSION_PRESETS;
  readonly submitting = signal(false);
  readonly error = signal('');
  mode: string = '1y';
  customDate = '';
  customTouched = false;

  get organizationName(): string {
    return organizationLabel(this.license);
  }

  get state() {
    return licenseState(this.license);
  }

  get lapsed(): boolean {
    const expiresAt = this.license?.expiresAt ? new Date(this.license.expiresAt).getTime() : 0;
    return !expiresAt || expiresAt < Date.now();
  }

  get newExpiry(): Date | null {
    if (this.mode === 'custom') {
      const date = this.customDate ? new Date(this.customDate) : null;
      return date && !Number.isNaN(date.getTime()) ? date : null;
    }
    const preset = this.presets.find((option) => option.id === this.mode);
    return preset ? previewExtension(this.license?.expiresAt, preset.months) : null;
  }

  get customError(): string {
    if (this.mode !== 'custom' || !this.customTouched) return '';
    const date = this.newExpiry;
    if (!date) return 'Enter the new expiry date.';
    if (date.getTime() <= Date.now()) return 'The new expiry date must be in the future.';
    const current = this.license?.expiresAt ? new Date(this.license.expiresAt).getTime() : 0;
    if (date.getTime() <= current) return 'The new expiry date must be after the current one.';
    return '';
  }

  setMode(mode: string): void {
    this.mode = mode;
    this.error.set('');
  }

  close(): void {
    if (!this.submitting()) this.closed.emit();
  }

  submit(): void {
    if (this.submitting()) return;
    const body: Record<string, unknown> = {};
    if (this.mode === 'custom') {
      this.customTouched = true;
      if (this.customError || !this.newExpiry) return;
      body['expiresAt'] = this.newExpiry.toISOString();
    } else {
      body['months'] = this.presets.find((option) => option.id === this.mode)?.months;
    }

    this.submitting.set(true);
    this.error.set('');
    this.api.create<LicenseRow>(`/api/v1/licenses/${this.license.id}/extend`, body).subscribe({
      next: (response: ApiResponse<LicenseRow> & { meta?: { warnings?: string[] } }) => {
        this.submitting.set(false);
        this.extended.emit({
          license: { ...this.license, ...(response.data || {}) },
          message: response.message || 'License extended.',
          warnings: response.meta?.warnings || [],
        });
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Unable to extend license.');
      },
    });
  }
}
