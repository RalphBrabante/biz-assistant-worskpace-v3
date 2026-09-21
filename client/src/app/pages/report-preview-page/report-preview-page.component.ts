import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { OrganizationContextService } from '../../core/organization-context.service';

interface ExpenseRow {
  id: string;
  expenseDate: string;
  category?: string;
  description?: string;
  status?: string;
  currency?: string;
  amount?: number;
  taxableAmount?: number;
  taxAmount?: number;
  vatExemptAmount?: number;
  withHoldingTaxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  vendor?: {
    id: string;
    name?: string;
    legalName?: string;
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
    name?: string;
    percentage?: number;
  };
}

interface ReportRow {
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
  report: ReportRow;
  summary: PreviewSummary;
  expenses: ExpenseRow[];
}

@Component({
  selector: 'app-report-preview-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './report-preview-page.component.html',
})
export class ReportPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly organizationContext = inject(OrganizationContextService);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly report = signal<ReportRow | null>(null);
  readonly summary = signal<PreviewSummary | null>(null);
  readonly expenses = signal<ExpenseRow[]>([]);

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
    this.expenses.set([]);

    const params = new URLSearchParams();
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (organizationId && this.organizationContext.shouldApplySuperuserScope()) {
      params.set('organizationId', organizationId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';

    this.api
      .get<PreviewResponse>(`/api/v1/reports/quarterly-expenses/${reportId}/preview${suffix}`)
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
