import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
export class ExpenseDetailPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly expense = signal<ExpenseDetail | null>(null);
  readonly previewImageUrl = signal('');
  readonly attachmentImageFailed = signal(false);

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
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load expense.');
      },
    });
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

  attachmentUrl(): string {
    const row = this.expense();
    if (!row) {
      return '';
    }
    return String(row.fileCdnUrl || row.file || row.receiptUrl || '').trim();
  }

  attachmentName(): string {
    const url = this.attachmentUrl();
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

  isImageAttachment(url = this.attachmentUrl()): boolean {
    const cleanUrl = String(url || '').split('?')[0].split('#')[0].toLowerCase();
    return (
      cleanUrl.startsWith('data:image/') ||
      cleanUrl.endsWith('.jpg') ||
      cleanUrl.endsWith('.jpeg') ||
      cleanUrl.endsWith('.png') ||
      cleanUrl.endsWith('.gif') ||
      cleanUrl.endsWith('.webp') ||
      cleanUrl.endsWith('.bmp')
    );
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
