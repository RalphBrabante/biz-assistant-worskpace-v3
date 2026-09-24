import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SalesInvoiceRow, SalesReportRow, downloadSalesReport } from '../../core/sales-report-export';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { OrganizationContextService } from '../../core/organization-context.service';

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
  styleUrl: '../../shared/report-tables.css',
})
export class SalesReportPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly exportError = signal('');
  readonly exporting = signal(false);
  private previewSub?: Subscription;
  private routeSub?: Subscription;
  readonly report = signal<SalesReportRow | null>(null);
  readonly summary = signal<SalesPreviewSummary | null>(null);
  readonly salesInvoices = signal<SalesInvoiceRow[]>([]);

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const reportId = String(params.get('id') || '').trim();
      if (!reportId) {
        this.error.set('Report id is required.');
        return;
      }
      this.load(reportId);
    });
  }

  ngOnDestroy(): void { this.routeSub?.unsubscribe(); this.previewSub?.unsubscribe(); }

  private load(reportId: string): void {
    this.previewSub?.unsubscribe();
    this.exportError.set('');
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

    this.previewSub = this.api
      .getFresh<SalesPreviewResponse>(`/api/v1/reports/quarterly-sales/${encodeURIComponent(reportId)}/preview${suffix}`)
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

  async exportExcel(): Promise<void> {
    const report = this.report();
    if (!report || this.loading() || this.error() || this.exporting()) return;
    this.exporting.set(true); this.exportError.set('');
    try {
      await downloadSalesReport(report, this.salesInvoices());
    } catch (error) {
      this.exportError.set(error instanceof Error ? error.message : 'Unable to export this report. Please try again.');
    } finally {
      this.exporting.set(false);
    }
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
