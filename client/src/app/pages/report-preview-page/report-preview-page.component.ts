import { Subscription } from 'rxjs';
import { ExpenseRow, ExpenseReportRow, downloadExpenseReport } from '../../core/expense-report-export';
import { BirAlphalistExportComponent } from '../../shared/bir-alphalist-export.component';
import { expenseWithholdingLines } from '../../core/bir-alphalist-export';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { OrganizationContextService } from '../../core/organization-context.service';

interface PreviewSummary {
  expenseCount: number;
  amount: number;
  taxableAmount: number;
  taxAmount: number;
  vatExemptAmount: number;
  withHoldingTaxAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
}

interface PreviewResponse {
  report: ExpenseReportRow;
  summary: PreviewSummary;
  expenses: ExpenseRow[];
}

@Component({
  selector: 'app-report-preview-page',
  standalone: true,
  imports: [CommonModule, RouterLink, BirAlphalistExportComponent],
  templateUrl: './report-preview-page.component.html',
  styleUrl: '../../shared/report-tables.css',
})
export class ReportPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly exportError = signal('');
  readonly exporting = signal(false);
  private previewSub?: Subscription;
  private routeSub?: Subscription;
  readonly report = signal<ExpenseReportRow | null>(null);
  readonly summary = signal<PreviewSummary | null>(null);
  readonly expenses = signal<ExpenseRow[]>([]);
  readonly withholdingLines = computed(() => expenseWithholdingLines(this.expenses(), this.report()?.currency || 'PHP'));

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const reportId = String(params.get('id') || '').trim();
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
    this.expenses.set([]);

    if (!reportId) { this.loading.set(false); this.error.set('Report id is required.'); return; }

    const params = new URLSearchParams();
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (organizationId && this.organizationContext.shouldApplySuperuserScope()) {
      params.set('organizationId', organizationId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';

    this.previewSub = this.api
      .getFresh<PreviewResponse>(`/api/v1/reports/quarterly-expenses/${encodeURIComponent(reportId)}/preview${suffix}`)
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.report.set(response.data?.report || null);
          this.summary.set(response.data?.summary || null);
          this.expenses.set(response.data?.expenses || []);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err?.error?.message || 'Unable to load report preview.');
        },
      });
  }

  async exportExcel(): Promise<void> {
    const report = this.report();
    if (!report || this.loading() || this.error() || this.exporting()) return;
    this.exporting.set(true); this.exportError.set('');
    try {
      await downloadExpenseReport(report, this.expenses());
    } catch (error) {
      this.exportError.set(error instanceof Error ? error.message : 'Unable to export this report. Please try again.');
    } finally { this.exporting.set(false); }
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

  vendorLabel(row: ExpenseRow): string {
    return row.vendor?.name || row.vendor?.legalName || '-';
  }

  taxTypeLabel(row: ExpenseRow): string {
    const code = String(row.taxType?.code || '').trim();
    const pct = row.taxType?.percentage;
    if (code && pct !== undefined && pct !== null) {
      return `${code} (${pct}%)`;
    }
    return code || row.taxType?.name || '-';
  }

  trackById(_index: number, row: { id: string }): string {
    return row.id;
  }
}
