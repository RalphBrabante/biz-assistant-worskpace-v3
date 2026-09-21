import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  iconClass?: string;
}

interface ConfirmDialogState {
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  confirmButtonClass: string;
  iconClass: string;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly state = signal<ConfirmDialogState>({
    visible: false,
    title: 'Confirm Action',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    confirmButtonClass: 'ui-btn-danger',
    iconClass: 'bi-exclamation-triangle',
  });

  private resolver: ((confirmed: boolean) => void) | null = null;

  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    if (this.resolver) {
      this.resolver(false);
      this.resolver = null;
    }

    this.state.set({
      visible: true,
      title: options.title || 'Confirm Action',
      message: options.message,
      confirmText: options.confirmText || 'Confirm',
      cancelText: options.cancelText || 'Cancel',
      confirmButtonClass: options.confirmButtonClass || 'ui-btn-danger',
      iconClass: options.iconClass || 'bi-exclamation-triangle',
    });

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  approve(): void {
    this.finish(true);
  }

  cancel(): void {
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.resolver) {
      this.resolver(confirmed);
      this.resolver = null;
    }

    const current = this.state();
    this.state.set({
      ...current,
      visible: false,
    });
  }
}

