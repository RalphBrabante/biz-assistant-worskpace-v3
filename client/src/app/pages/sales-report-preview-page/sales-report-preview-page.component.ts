import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { OrganizationContextService } from '../../core/organization-context.service';

interface SalesInvoiceRow {
  id: string;
  invoiceNumber?: string;
  issueDate?: string;
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
  order?: {
    id: string;
    orderNumber?: string;
    status?: string;
    paymentStatus?: string;
    customer?: {
      id: string;
      name?: string;
      taxId?: string;
    };
  };
}

interface SalesReportRow {
  id: string;
  year: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
}

interface SalesPreviewSummary {
  invoiceCount: number;
  amount: number;
  taxableAmount: number;
  withHoldingTaxAmount: number;
  subtotalAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
}

interface SalesPreviewResponse {
  report: SalesReportRow;
  summary: SalesPreviewSummary;
  salesInvoices: SalesInvoiceRow[];
}

@Component({
  selector: 'app-sales-report-preview-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sales-report-preview-page.component.html',
})
export class SalesReportPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly report = signal<SalesReportRow | null>(null);
  readonly summary = signal<SalesPreviewSummary | null>(null);
  readonly salesInvoices = signal<SalesInvoiceRow[]>([]);

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const reportId = String(params.get('id') || '').trim();
      if (!reportId) {
        this.error.set('Report id is required.');
        return;
      }
      this.load(reportId);
    });
  }

  private load(reportId: string): void {
    this.loading.set(true);
    this.error.set('');
    this.report.set(null);
    this.summary.set(null);
    this.salesInvoices.set([]);

    const params = new URLSearchParams();
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (organizationId && this.organizationContext.shouldApplySuperuserScope()) {
      params.set('organizationId', organizationId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';

    this.api
      .get<SalesPreviewResponse>(`/api/v1/reports/quarterly-sales/${reportId}/preview${suffix}`)
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.report.set(response.data?.report || null);
          this.summary.set(response.data?.summary || null);
          this.salesInvoices.set(response.data?.salesInvoices || []);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err?.error?.message || 'Unable to load sales report preview.');
        },
      });
  }

  quarterLabel(value: number | null | undefined): string {
    return `Q${Number(value || 0) || '-'}`;
  }

  toCurrency(value: number | string | null | undefined, currency = 'USD'): string {
    const numeric = Number(value || 0);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0);
  }

  customerLabel(row: SalesInvoiceRow): string {
    return row.order?.customer?.name || '-';
  }

  trackById(_index: number, row: { id: string }): string {
    return row.id;
  }
}
