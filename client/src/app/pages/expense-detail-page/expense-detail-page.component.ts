import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';

interface ExpenseDetail {
  id: string;
  organizationId: string;
  vendorId: string;
  vendorTaxId?: string;
  expenseNumber?: string;
  vatExemptAmount?: number;
  receiptVatAmount?: number | null;
  withholdingTaxBase?: number | null;
  taxableAmount?: number;
  withHoldingTaxAmount?: number;
  category: string;
  description?: string;
  expenseDate: string;
  dueDate?: string;
  status?: string;
  paymentMethod?: string;
  currency?: string;
  amount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  receiptUrl?: string;
  file?: string;
  fileCdnUrl?: string;
  notes?: string;
  vendor?: {
    id: string;
    name?: string;
    taxId?: string;
  };
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
  withholdingTaxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
}

@Component({
  selector: 'app-expense-detail-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, RouterLink],
  templateUrl: './expense-detail-page.component.html',
  styles: [
    `
      @media print {
        .no-print {
          display: none !important;
        }

        .print-card {
          box-shadow: none !important;
          border: 1px solid #d9d9d9 !important;
        }
      }
    `,
  ],
})
export class ExpenseDetailPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly expense = signal<ExpenseDetail | null>(null);
  readonly previewImageUrl = signal('');
  readonly attachmentImageFailed = signal(false);
  // Attachments are private: fetched with the session token and shown through a local object URL
  readonly attachmentObjectUrl = signal('');
  readonly attachmentIsImage = signal(false);
  readonly attachmentState = signal<'none' | 'loading' | 'ready' | 'failed'>('none');
  private attachmentRequest: Subscription | null = null;

  ngOnInit(): void {
    const id = String(this.route.snapshot.paramMap.get('id') || '').trim();
    if (!id) {
      this.error.set('Expense ID is required.');
      return;
    }
    this.load(id);
  }

  load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.api.get<ExpenseDetail>(`/api/v1/expenses/${id}`).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.attachmentImageFailed.set(false);
        this.expense.set(response.data || null);
        this.loadAttachment(id);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load expense.');
      },
    });
  }

  ngOnDestroy(): void {
    this.releaseAttachment();
  }

  private loadAttachment(id: string): void {
    this.releaseAttachment();
    if (!this.storedAttachmentUrl()) {
      return;
    }
    this.attachmentState.set('loading');
    this.attachmentRequest = this.api.download(`/api/v1/expenses/${id}/attachment`).subscribe({
      next: (blob) => {
        this.attachmentIsImage.set(blob.type.startsWith('image/'));
        this.attachmentObjectUrl.set(URL.createObjectURL(blob));
        this.attachmentState.set('ready');
      },
      error: () => this.attachmentState.set('failed'),
    });
  }

  hasAttachment(): boolean {
    return Boolean(this.storedAttachmentUrl());
  }

  // Older expenses may hold an external link (not a stored upload); offer it when it can't be served
  externalAttachmentUrl(): string {
    const url = this.storedAttachmentUrl();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  private releaseAttachment(): void {
    this.attachmentRequest?.unsubscribe();
    this.attachmentRequest = null;
    this.attachmentState.set('none');
    const objectUrl = this.attachmentObjectUrl();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    this.attachmentObjectUrl.set('');
    this.attachmentIsImage.set(false);
  }

  organizationLabel(): string {
    const row = this.expense();
    if (!row) return '-';
    return row.organization?.name || row.organization?.legalName || row.organizationId || '-';
  }

  vendorLabel(): string {
    const row = this.expense();
    if (!row) return '-';
    return row.vendor?.name || row.vendorId || '-';
  }

  taxTypeLabel(): string {
    const taxType = this.expense()?.taxType;
    if (!taxType) return '-';
    const code = String(taxType.code || '').trim();
    const name = String(taxType.name || '').trim();
    return [code, name].filter(Boolean).join(' - ') || '-';
  }

  withholdingLabel(): string {
    const withholding = this.expense()?.withholdingTaxType;
    if (!withholding) return '-';
    const code = String(withholding.code || '').trim();
    const name = String(withholding.name || '').trim();
    return [code, name].filter(Boolean).join(' - ') || '-';
  }

  formatMoney(value: unknown, currency?: string): string {
    const amount = Number(value ?? 0);
    const code = String(currency || this.expense()?.currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(amount) ? amount : 0);
    } catch (_err) {
      return `${code} ${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
    }
  }

  printPage(): void {
    window.print();
  }

  private storedAttachmentUrl(): string {
    const row = this.expense();
    if (!row) {
      return '';
    }
    return String(row.fileCdnUrl || row.file || row.receiptUrl || '').trim();
  }

  attachmentUrl(): string {
    return this.attachmentObjectUrl();
  }

  attachmentName(): string {
    const url = this.storedAttachmentUrl();
    if (!url) {
      return '';
    }
    const cleanUrl = url.split('?')[0].split('#')[0];
    const name = cleanUrl.split('/').filter(Boolean).pop() || 'Expense attachment';
    try {
      return decodeURIComponent(name);
    } catch (_err) {
      return name;
    }
  }

  isImageAttachment(_url = this.attachmentUrl()): boolean {
    return this.attachmentIsImage();
  }

  onAttachmentImageError(): void {
    this.attachmentImageFailed.set(true);
  }

  openImagePreview(url: string): void {
    const cleaned = String(url || '').trim();
    if (!cleaned) {
      return;
    }
    this.previewImageUrl.set(cleaned);
  }

  closeImagePreview(): void {
    this.previewImageUrl.set('');
  }
}
