import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';

interface SalesInvoiceRow {
  id: string;
  organizationId: string;
  orderId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  amount?: number;
  taxableAmount?: number;
  withHoldingTaxAmount?: number;
  subtotalAmount?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  paidAt?: string;
  notes?: string;
  order?: {
    id: string;
    orderNumber?: string;
    shippingAmount?: number;
    customer?: {
      id: string;
      name?: string;
      taxId?: string;
    };
    orderedItemSnapshots?: SnapshotRow[];
  };
}

interface SnapshotRow {
  id: string;
  name?: string;
  sku?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  lineSubtotal?: number;
  lineDiscount?: number;
  lineTax?: number;
  lineTotal?: number;
}

@Component({
  selector: 'app-sales-invoice-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './sales-invoice-detail-page.component.html',
})
export class SalesInvoiceDetailPageComponent {
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly invoice = signal<SalesInvoiceRow | null>(null);

  invoiceId = '';
  status = 'draft';
  private readonly currencyFormatterCache = new Map<string, Intl.NumberFormat>();

  readonly statusOptions = [
    'draft',
    'issued',
    'sent',
    'partially_paid',
    'overdue',
    'paid',
    'cancelled',
  ];

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly confirmDialog: ConfirmDialogService
  ) {}

  ngOnInit(): void {
    this.invoiceId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.invoiceId) {
      this.error.set('Sales invoice ID is missing.');
      return;
    }
    this.loadInvoice();
  }

  get isPaid(): boolean {
    return String(this.invoice()?.status || '').toLowerCase() === 'paid';
  }

  get printableStatus(): string {
    const current = String(this.invoice()?.status || '').toLowerCase();
    return current === 'void' ? 'cancelled' : current || '-';
  }

  get orderedItems(): SnapshotRow[] {
    return this.invoice()?.order?.orderedItemSnapshots || [];
  }

  get orderShippingAmount(): number {
    return Number(this.invoice()?.order?.shippingAmount || 0);
  }

  get itemsSubtotal(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get invoiceAmount(): number {
    return Number(this.invoice()?.amount ?? this.invoice()?.subtotalAmount ?? this.itemsSubtotal ?? 0);
  }

  get invoiceTaxableAmount(): number {
    const row = this.invoice();
    if (!row) return 0;
    if (row.taxableAmount !== undefined && row.taxableAmount !== null) {
      return Number(row.taxableAmount || 0);
    }
    return Number(Math.max(this.invoiceAmount - Number(row.taxAmount || 0), 0).toFixed(2));
  }

  get invoiceWithHoldingTaxAmount(): number {
    return Number(this.invoice()?.withHoldingTaxAmount || 0);
  }

  get itemsDiscount(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    return Number(value.toFixed(2));
  }

  get itemsTax(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    return Number(value.toFixed(2));
  }

  get itemsTotal(): number {
    const value = this.orderedItems.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0) + this.orderShippingAmount;
    return Number(value.toFixed(2));
  }

  get invoicePaidTotal(): number {
    const row = this.invoice();
    if (!row) {
      return 0;
    }
    if (row.totalAmount !== undefined && row.totalAmount !== null) {
      return Number(row.totalAmount || 0);
    }
    const subtotal = Number(row.subtotalAmount ?? row.amount ?? this.itemsSubtotal);
    const discount = Number(row.discountAmount || 0);
    const withholding = Number(row.withHoldingTaxAmount || 0);
    return Number(Math.max(subtotal - discount - withholding, 0).toFixed(2));
  }

  get invoiceCurrency(): string {
    return String(this.invoice()?.currency || 'USD').toUpperCase();
  }

  formatMoney(value: unknown, currency?: string): string {
    const amount = Number(value ?? 0);
    const code = String(currency || this.invoiceCurrency || 'USD').toUpperCase();
    const normalizedAmount = Number.isFinite(amount) ? amount : 0;
    const formatter = this.currencyFormatterCache.get(code);
    if (formatter) {
      return formatter.format(normalizedAmount);
    }

    try {
      const created = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      this.currencyFormatterCache.set(code, created);
      return created.format(normalizedAmount);
    } catch (_err) {
      return `${code} ${normalizedAmount.toFixed(2)}`;
    }
  }

  trackBySnapshotId(index: number, row: SnapshotRow): string {
    return row.id || String(index);
  }

  async saveStatus(): Promise<void> {
    if (this.submitting() || !this.invoiceId || this.isPaid) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Sales Invoice',
      message: 'Save the new sales invoice status?',
      confirmText: 'Update Invoice',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    this.api
      .update<SalesInvoiceRow>('/api/v1/sales-invoices', this.invoiceId, { status: this.status })
      .subscribe({
        next: (response: ApiResponse<SalesInvoiceRow>) => {
          this.submitting.set(false);
          this.message.set(response.message || 'Sales invoice status updated successfully.');
          this.loadInvoice();
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Unable to update sales invoice status.');
        },
      });
  }

  async markCancelled(): Promise<void> {
    if (this.submitting() || this.isPaid) {
      return;
    }
    this.status = 'cancelled';
    await this.saveStatus();
  }

  printInvoice(): void {
    window.print();
  }

  private loadInvoice(): void {
    this.loading.set(true);
    this.error.set('');

    this.api.get<SalesInvoiceRow>(`/api/v1/sales-invoices/${this.invoiceId}`).subscribe({
      next: (response: ApiResponse<SalesInvoiceRow>) => {
        this.loading.set(false);
        const row = response.data || null;
        this.invoice.set(row);
        this.status = this.normalizeStatusForUi(row?.status);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Unable to load sales invoice.');
      },
    });
  }

  private normalizeStatusForUi(status: unknown): string {
    const normalized = String(status || '').toLowerCase();
    return normalized === 'void' ? 'cancelled' : normalized || 'draft';
  }
}
