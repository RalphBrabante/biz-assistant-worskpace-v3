import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ApiResponse } from '../../core/types';
import {
  downloadGimoFinancialStatement,
  GimoPurchaseExportLine,
  GimoSalesExportLine,
} from '../../core/gimo-financial-statement-export';
import { loadTablePreferences, saveTablePreferences, toPositiveInt, toTableViewMode, TableViewMode } from '../../core/table-preferences';

interface QuarterlySalesReportRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  year: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  invoiceCount: number;
  currency: string;
  subtotalAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  generatedAt: string;
}

interface QuarterlyExpenseReportRow {
  id: string;
  organizationId: string;
  organization?: {
    id: string;
    name?: string;
    legalName?: string;
  };
  year: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  expenseCount: number;
  currency: string;
  amount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  generatedAt: string;
}

interface OrganizationTaxInfo {
  id: string;
  currency?: string;
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
  };
}

interface WithholdingPayeeSummary {
  payeeId: string;
  payeeName: string;
  payeeTin: string;
  withholdingTaxTypeId: string;
  atcCode: string;
  withholdingTypeName: string;
  rate: number;
  taxableBase: number;
  amountWithheld: number;
  transactionCount: number;
}

interface BirFilingSummary {
  organization?: OrganizationTaxInfo & {
    name?: string;
    legalName?: string;
    taxpayerClassification?: string;
    taxpayerClassificationLabel?: string;
    deductionMethod?: string;
    incomeTaxRate?: number;
    isIncomeTaxExempt?: boolean;
  };
  year: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
  sales: {
    invoiceCount: number;
    grossReceipts: number;
    outputVat: number;
    discountAmount: number;
    totalAmount: number;
  };
  expenses: {
    expenseCount: number;
    grossAmount: number;
    inputVat: number;
    discountAmount: number;
    deductibleExpenses: number;
    taxableBase: number;
    amountWithheld: number;
  };
  businessTax: {
    form: string;
    taxTypeCode: string;
    taxTypeName: string;
    rate: number;
    grossReceipts: number;
    outputVat: number;
    inputVat: number;
    netVatPayable: number;
    inputVatExcess: number;
    percentageTaxDue: number;
  };
  incomeTax: {
    forms: string[];
    taxpayerClassification: string;
    taxpayerClassificationLabel: string;
    deductionMethod: string;
    incomeTaxRate: number;
    isIncomeTaxExempt: boolean;
    grossIncome: number;
    deductibleExpenses: number;
    netTaxableIncomeEstimate: number;
    estimatedIncomeTaxDue: number;
    caveats?: string[];
  };
  withholding: {
    currency: string;
    taxableBase: number;
    amountWithheld: number;
    expenseCount: number;
    groups: Array<{
      withholdingTaxTypeId: string;
      code: string;
      name: string;
      percentage: number;
      taxableBase: number;
      amountWithheld: number;
      expenseCount: number;
    }>;
    payees: WithholdingPayeeSummary[];
  };
  certificates2307: {
    payeeCount: number;
    totalTaxableBase: number;
    totalAmountWithheld: number;
    payees: WithholdingPayeeSummary[];
  };
  attachments: {
    sawt: {
      supported: boolean;
      lineCount: number;
      incomePayment: number;
      taxWithheld: number;
      lines: Array<{
        date: string;
        referenceNumber: string;
        customerName: string;
        customerTin: string;
        atcCode?: string;
        withholdingTypeName?: string;
        rate?: number;
        incomePayment: number;
        taxWithheld: number;
      }>;
    };
    qap: {
      supported: boolean;
      lineCount: number;
      incomePayment: number;
      taxWithheld: number;
      lines: Array<{
        date: string;
        referenceNumber: string;
        payeeName: string;
        payeeTin: string;
        atcCode: string;
        withholdingTaxTypeId?: string;
        withholdingTypeName?: string;
        grossAmount?: number;
        incomePayment: number;
        inputVat?: number;
        rate: number;
        taxWithheld: number;
        netPayable?: number;
      }>;
    };
    slsp: {
      supported: boolean;
      salesLineCount: number;
      purchaseLineCount: number;
      sales: Array<{
        date: string;
        referenceNumber: string;
        customerName: string;
        customerTin: string;
        grossSales: number;
        taxableSales: number;
        outputVat: number;
        withholdingTaxTypeId?: string;
        atcCode?: string;
        withholdingTypeName?: string;
        withholdingRate?: number;
        taxWithheld?: number;
      }>;
      purchases: Array<{
        date: string;
        referenceNumber: string;
        vendorName: string;
        vendorTin: string;
        grossPurchases: number;
        taxablePurchases: number;
        inputVat: number;
        withholdingTaxTypeId?: string;
        atcCode?: string;
        withholdingTypeName?: string;
        withholdingRate?: number;
        taxWithheld?: number;
      }>;
    };
  };
}

@Component({
  selector: 'app-reports-page',
  standalone: true,
  imports: [OrganizationRequiredComponent, CommonModule, FormsModule, RouterLink],
  templateUrl: './reports-page.component.html',
  styleUrl: '../../shared/report-tables.css',
})
export class ReportsPageComponent {
  private readonly api: ApiService;
  private readonly auth: AuthService;
  private readonly confirmDialog: ConfirmDialogService;
  private readonly organizationContext: OrganizationContextService;

  constructor(api: ApiService, auth: AuthService, confirmDialog: ConfirmDialogService, organizationContext: OrganizationContextService) {
    this.api = api;
    this.auth = auth;
    this.confirmDialog = confirmDialog;
    this.organizationContext = organizationContext;
  }

  readonly salesRows = signal<QuarterlySalesReportRow[]>([]);
  readonly latestSalesReport = signal<QuarterlySalesReportRow | null>(null);
  readonly loadingSales = signal(false);
  readonly generatingSales = signal(false);
  readonly regeneratingSalesReportId = signal('');
  readonly deletingSalesReportId = signal('');
  readonly salesError = signal('');
  readonly salesMessage = signal('');

  readonly expenseRows = signal<QuarterlyExpenseReportRow[]>([]);
  readonly latestExpenseReport = signal<QuarterlyExpenseReportRow | null>(null);
  readonly loadingExpenses = signal(false);
  readonly generatingExpenses = signal(false);
  readonly regeneratingExpenseReportId = signal('');
  readonly deletingExpenseReportId = signal('');
  readonly expenseError = signal('');
  readonly expenseMessage = signal('');

  readonly selectedYear = signal(new Date().getFullYear());
  readonly selectedQuarter = signal(this.getCurrentQuarter());
  readonly organizationTaxTypeCode = signal('');
  readonly organizationTaxTypeName = signal('');
  readonly organizationTaxRate = signal(0);
  readonly organizationCurrency = signal('');
  readonly filingSummary = signal<BirFilingSummary | null>(null);
  readonly loadingFilingSummary = signal(false);
  readonly filingSummaryError = signal('');
  readonly generatingFilingReports = signal(false);

  salesPage = 1;
  salesPageSize = 20;
  salesTotal = 0;
  salesTotalPages = 1;

  expensePage = 1;
  expensePageSize = 20;
  expenseTotal = 0;
  expenseTotalPages = 1;

  readonly pageSizeOptions = [10, 20, 50, 100];
  viewMode: TableViewMode = 'table';
  private readonly tablePrefsKey = 'reports-page';
  private readonly organizationNameMap = signal<Record<string, string>>({});

  readonly availableYears = computed(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => currentYear - index);
  });

  readonly filingWorksheet = computed(() => {
    const salesReport = this.findSelectedSalesReport(this.salesRows());
    const expenseReport = this.findSelectedExpenseReport(this.expenseRows());
    const summary = this.filingSummary();
    const currency =
      summary?.currency ||
      salesReport?.currency ||
      expenseReport?.currency ||
      this.organizationCurrency() ||
      this.currentOrganizationCurrency;
    const grossReceipts = Number(summary?.businessTax?.grossReceipts ?? salesReport?.subtotalAmount ?? 0);
    const outputVat = Number(summary?.businessTax?.outputVat ?? salesReport?.taxAmount ?? 0);
    const inputVat = Number(summary?.businessTax?.inputVat ?? expenseReport?.taxAmount ?? 0);
    const netVatPayable = Number(summary?.businessTax?.netVatPayable ?? Math.max(outputVat - inputVat, 0));
    const inputVatExcess = Number(summary?.businessTax?.inputVatExcess ?? Math.max(inputVat - outputVat, 0));
    const deductibleExpenses = Number(summary?.incomeTax?.deductibleExpenses ?? expenseReport?.totalAmount ?? 0);
    const netTaxableIncomeEstimate = Number(
      summary?.incomeTax?.netTaxableIncomeEstimate ?? Math.max(grossReceipts - deductibleExpenses, 0)
    );
    const percentageTaxDue = Number(
      summary?.businessTax?.percentageTaxDue ??
      (this.isPercentageTaxOrganization ? Number((grossReceipts * (this.organizationTaxRate() / 100)).toFixed(2)) : 0)
    );

    return {
      summary,
      salesReport,
      expenseReport,
      currency,
      grossReceipts,
      outputVat,
      inputVat,
      netVatPayable,
      inputVatExcess,
      deductibleExpenses,
      netTaxableIncomeEstimate,
      percentageTaxDue,
      withholding: summary?.withholding || null,
    };
  });

  get currentOrganizationCurrency(): string {
    return String(this.organizationCurrency() || this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  get canGenerateReports(): boolean {
    return this.auth.hasPermission('reports.generate');
  }

  get canDeleteReports(): boolean {
    return this.auth.hasPermission('reports.delete');
  }

  get hasOrganizationContext(): boolean {
    return Boolean(this.organizationContext.getActiveOrganizationId().trim());
  }

  get isContextLocked(): boolean {
    return this.isSuperuser && !this.hasOrganizationContext;
  }

  get isPercentageTaxOrganization(): boolean {
    return this.organizationTaxTypeCode() === 'PT';
  }

  get isVatOrganization(): boolean {
    return this.organizationTaxTypeCode() === 'VAT';
  }

  get organizationTaxLabel(): string {
    if (this.isPercentageTaxOrganization) {
      return `Percentage Tax (${this.organizationTaxRate() || 0}%)`;
    }
    if (this.isVatOrganization) {
      return `VAT (${this.organizationTaxRate() || 12}%)`;
    }
    return this.organizationTaxTypeName() || 'Tax type not set';
  }

  get businessTaxFormLabel(): string {
    return this.isPercentageTaxOrganization ? 'BIR 2551Q' : 'BIR 2550Q';
  }

  get businessTaxWorksheetTitle(): string {
    return this.isPercentageTaxOrganization
      ? 'Percentage Tax Worksheet'
      : 'VAT Worksheet';
  }


  private get orgParamValue(): string {
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (!organizationId) {
      return '';
    }
    if (this.isSuperuser && !this.organizationContext.shouldApplySuperuserScope()) {
      return '';
    }
    return organizationId;
  }

  ngOnInit(): void {
    this.restoreTablePreferences();
    if (this.isSuperuser) {
      this.loadOrganizations();
    }
    this.loadOrganizationTaxInfo();
    this.loadSalesReports();
    this.loadExpenseReports();
    this.loadBirFilingSummary();
  }

  private loadOrganizations(): void {
    this.api.list<{ id: string; name?: string; legalName?: string }>('/api/v1/organizations?limit=500').subscribe({
      next: (response) => {
        const map: Record<string, string> = {};
        for (const org of response.data || []) {
          const id = String(org.id || '').trim();
          if (!id) continue;
          map[id] = String(org.name || org.legalName || id).trim() || id;
        }
        this.organizationNameMap.set(map);
      },
      error: () => {
        this.organizationNameMap.set({});
      },
    });
  }

  private loadOrganizationTaxInfo(): void {
    const organizationId = this.orgParamValue;
    if (!organizationId) {
      this.organizationTaxTypeCode.set('');
      this.organizationTaxTypeName.set('');
      this.organizationTaxRate.set(0);
      this.organizationCurrency.set('');
      return;
    }

    this.api.get<OrganizationTaxInfo>(`/api/v1/organizations/${encodeURIComponent(organizationId)}`).subscribe({
      next: (response) => {
        const taxType = response.data?.taxType;
        this.organizationTaxTypeCode.set(String(taxType?.code || '').toUpperCase());
        this.organizationTaxTypeName.set(String(taxType?.name || taxType?.code || '').trim());
        const rate = Number(taxType?.percentage || 0);
        this.organizationTaxRate.set(Number.isFinite(rate) && rate > 0 ? rate : 0);
        this.organizationCurrency.set(String(response.data?.currency || '').toUpperCase());
      },
      error: () => {
        this.organizationTaxTypeCode.set('');
        this.organizationTaxTypeName.set('');
        this.organizationTaxRate.set(0);
        this.organizationCurrency.set('');
      },
    });
  }

  loadBirFilingSummary(): void {
    if (this.isContextLocked) {
      this.loadingFilingSummary.set(false);
      this.filingSummary.set(null);
      this.filingSummaryError.set('');
      return;
    }
    const organizationId = this.orgParamValue;
    if (!organizationId) {
      this.loadingFilingSummary.set(false);
      this.filingSummary.set(null);
      this.filingSummaryError.set('Select an organization to prepare BIR filing worksheets.');
      return;
    }

    this.loadingFilingSummary.set(true);
    this.filingSummaryError.set('');
    const params = new URLSearchParams({
      organizationId,
      year: String(this.selectedYear()),
      quarter: String(this.selectedQuarter()),
    });

    this.api.get<BirFilingSummary>(`/api/v1/reports/bir-filing-summary?${params.toString()}`).subscribe({
      next: (response) => {
        this.loadingFilingSummary.set(false);
        const summary = response.data || null;
        this.filingSummary.set(summary);
        const taxType = summary?.organization?.taxType;
        if (taxType) {
          this.organizationTaxTypeCode.set(String(taxType.code || '').toUpperCase());
          this.organizationTaxTypeName.set(String(taxType.name || taxType.code || '').trim());
          const rate = Number(taxType.percentage || 0);
          this.organizationTaxRate.set(Number.isFinite(rate) && rate > 0 ? rate : 0);
        }
        if (summary?.currency) {
          this.organizationCurrency.set(String(summary.currency).toUpperCase());
        }
      },
      error: (err) => {
        this.loadingFilingSummary.set(false);
        this.filingSummary.set(null);
        this.filingSummaryError.set(err?.error?.message || 'Unable to load BIR filing summary.');
      },
    });
  }

  organizationLabelById(organizationId: string): string {
    const id = String(organizationId || '').trim();
    if (!id) {
      return '-';
    }
    return this.organizationNameMap()[id] || id;
  }

  loadSalesReports(): void {
    if (this.isContextLocked) {
      this.loadingSales.set(false);
      this.salesRows.set([]);
      this.latestSalesReport.set(null);
      this.salesTotal = 0;
      this.salesTotalPages = 1;
      this.salesPage = 1;
      this.salesError.set('');
      return;
    }
    this.loadingSales.set(true);
    this.salesError.set('');

    const params = new URLSearchParams({
      page: String(this.salesPage),
      limit: String(this.salesPageSize),
    });
    if (this.orgParamValue) {
      params.set('organizationId', this.orgParamValue);
    }

    this.api.list<QuarterlySalesReportRow>(`/api/v1/reports/quarterly-sales?${params.toString()}`).subscribe({
      next: (response: ApiResponse<QuarterlySalesReportRow[]>) => {
        this.loadingSales.set(false);
        const rows = (response.data || []).filter((row) =>
          this.isSuperuser || row.organizationId === this.orgParamValue
        );
        this.salesRows.set(rows);
        this.latestSalesReport.set(this.findSelectedSalesReport(rows));

        const meta = response.meta || {};
        this.salesTotal = Number(meta.total || 0);
        this.salesTotalPages = Math.max(1, Number(meta.totalPages || 1));
        this.salesPage = Math.max(1, Number(meta.page || this.salesPage));
        this.salesPageSize = Math.max(1, Number(meta.limit || this.salesPageSize));
        this.persistTablePreferences();
      },
      error: (err) => {
        this.loadingSales.set(false);
        this.salesError.set(err?.error?.message || 'Unable to load sales reports.');
      },
    });
  }

  loadExpenseReports(): void {
    if (this.isContextLocked) {
      this.loadingExpenses.set(false);
      this.expenseRows.set([]);
      this.latestExpenseReport.set(null);
      this.expenseTotal = 0;
      this.expenseTotalPages = 1;
      this.expensePage = 1;
      this.expenseError.set('');
      return;
    }
    this.loadingExpenses.set(true);
    this.expenseError.set('');

    const params = new URLSearchParams({
      page: String(this.expensePage),
      limit: String(this.expensePageSize),
    });
    if (this.orgParamValue) {
      params.set('organizationId', this.orgParamValue);
    }

    this.api.list<QuarterlyExpenseReportRow>(`/api/v1/reports/quarterly-expenses?${params.toString()}`).subscribe({
      next: (response: ApiResponse<QuarterlyExpenseReportRow[]>) => {
        this.loadingExpenses.set(false);
        const rows = (response.data || []).filter((row) =>
          this.isSuperuser || row.organizationId === this.orgParamValue
        );
        this.expenseRows.set(rows);
        this.latestExpenseReport.set(this.findSelectedExpenseReport(rows));

        const meta = response.meta || {};
        this.expenseTotal = Number(meta.total || 0);
        this.expenseTotalPages = Math.max(1, Number(meta.totalPages || 1));
        this.expensePage = Math.max(1, Number(meta.page || this.expensePage));
        this.expensePageSize = Math.max(1, Number(meta.limit || this.expensePageSize));
        this.persistTablePreferences();
      },
      error: (err) => {
        this.loadingExpenses.set(false);
        this.expenseError.set(err?.error?.message || 'Unable to load expense reports.');
      },
    });
  }

  generateQuarterlySalesReport(report?: QuarterlySalesReportRow): void {
    if (this.isContextLocked) return;
    const isRowRegeneration = Boolean(report?.id);
    if (isRowRegeneration) {
      this.regeneratingSalesReportId.set(report?.id || '');
    } else {
      this.generatingSales.set(true);
    }
    this.salesError.set('');
    this.salesMessage.set('');

    const payload = {
      year: report?.year || this.selectedYear(),
      quarter: report?.quarter || this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
      ...(report?.organizationId ? { organizationId: report.organizationId } : {}),
      ...(!report?.organizationId && this.orgParamValue ? { organizationId: this.orgParamValue } : {}),
    };

    this.api.create<QuarterlySalesReportRow>('/api/v1/reports/quarterly-sales', payload).subscribe({
      next: (response) => {
        this.generatingSales.set(false);
        this.regeneratingSalesReportId.set('');
        this.salesMessage.set(response.message || 'Quarterly sales report generated successfully.');
        if (response.data) {
          this.latestSalesReport.set(response.data);
        }
        this.salesPage = 1;
        this.loadSalesReports();
        this.loadBirFilingSummary();
      },
      error: (err) => {
        this.generatingSales.set(false);
        this.regeneratingSalesReportId.set('');
        this.salesError.set(err?.error?.message || 'Unable to generate sales report.');
      },
    });
  }

  generateQuarterlyExpenseReport(report?: QuarterlyExpenseReportRow): void {
    if (this.isContextLocked) return;
    const isRowRegeneration = Boolean(report?.id);
    if (isRowRegeneration) {
      this.regeneratingExpenseReportId.set(report?.id || '');
    } else {
      this.generatingExpenses.set(true);
    }
    this.expenseError.set('');
    this.expenseMessage.set('');

    const payload = {
      year: report?.year || this.selectedYear(),
      quarter: report?.quarter || this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
      ...(report?.organizationId ? { organizationId: report.organizationId } : {}),
      ...(!report?.organizationId && this.orgParamValue ? { organizationId: this.orgParamValue } : {}),
    };

    this.api.create<QuarterlyExpenseReportRow>('/api/v1/reports/quarterly-expenses', payload).subscribe({
      next: (response) => {
        this.generatingExpenses.set(false);
        this.regeneratingExpenseReportId.set('');
        this.expenseMessage.set(response.message || 'Quarterly expense report generated successfully.');
        if (response.data) {
          this.latestExpenseReport.set(response.data);
        }
        this.expensePage = 1;
        this.loadExpenseReports();
        this.loadBirFilingSummary();
      },
      error: (err) => {
        this.generatingExpenses.set(false);
        this.regeneratingExpenseReportId.set('');
        this.expenseError.set(err?.error?.message || 'Unable to generate expense report.');
      },
    });
  }

  selectedQuarterSalesReport(): QuarterlySalesReportRow | null {
    return this.findSelectedSalesReport(this.salesRows());
  }

  selectedQuarterExpenseReport(): QuarterlyExpenseReportRow | null {
    return this.findSelectedExpenseReport(this.expenseRows());
  }

  generateSelectedQuarterFilingReports(): void {
    if (this.isContextLocked || this.generatingFilingReports()) return;
    this.generatingFilingReports.set(true);
    this.salesError.set('');
    this.expenseError.set('');
    this.salesMessage.set('');
    this.expenseMessage.set('');

    const payload = {
      year: this.selectedYear(),
      quarter: this.selectedQuarter(),
      currency: this.currentOrganizationCurrency,
      ...(this.orgParamValue ? { organizationId: this.orgParamValue } : {}),
    };
    let remaining = 2;
    const completeOne = () => {
      remaining -= 1;
      if (remaining <= 0) {
        this.generatingFilingReports.set(false);
        this.salesPage = 1;
        this.expensePage = 1;
        this.loadSalesReports();
        this.loadExpenseReports();
        this.loadBirFilingSummary();
      }
    };

    this.api.create<QuarterlySalesReportRow>('/api/v1/reports/quarterly-sales', payload).subscribe({
      next: (response) => {
        if (response.data) {
          this.latestSalesReport.set(response.data);
        }
        this.salesMessage.set(response.message || 'Quarterly sales report generated successfully.');
        completeOne();
      },
      error: (err) => {
        this.salesError.set(err?.error?.message || 'Unable to generate sales report.');
        completeOne();
      },
    });

    this.api.create<QuarterlyExpenseReportRow>('/api/v1/reports/quarterly-expenses', payload).subscribe({
      next: (response) => {
        if (response.data) {
          this.latestExpenseReport.set(response.data);
        }
        this.expenseMessage.set(response.message || 'Quarterly expense report generated successfully.');
        completeOne();
      },
      error: (err) => {
        this.expenseError.set(err?.error?.message || 'Unable to generate expense report.');
        completeOne();
      },
    });
  }

  downloadFilingCsv(type: '2307' | 'sawt' | 'qap'): void {
    const summary = this.filingSummary();
    if (!summary) return;

    let filename = '';
    let rows: Array<Record<string, string | number>> = [];
    let templateRow: Record<string, string | number> = {};
    switch (type) {
      case '2307':
        filename = 'bir-2307-payees';
        templateRow = {
          payeeName: '',
          payeeTin: '',
          atcCode: '',
          withholdingType: '',
          rate: '',
          taxableBase: '',
          amountWithheld: '',
          transactionCount: '',
        };
        rows = summary.certificates2307.payees.map((payee) => ({
          payeeName: payee.payeeName,
          payeeTin: payee.payeeTin,
          atcCode: payee.atcCode,
          withholdingType: payee.withholdingTypeName,
          rate: payee.rate,
          taxableBase: payee.taxableBase,
          amountWithheld: payee.amountWithheld,
          transactionCount: payee.transactionCount,
        }));
        break;
      case 'sawt':
        filename = 'bir-sawt-lines';
        templateRow = {
          date: '',
          referenceNumber: '',
          customerName: '',
          customerTin: '',
          atcCode: '',
          withholdingTypeName: '',
          rate: '',
          incomePayment: '',
          taxWithheld: '',
        };
        rows = summary.attachments.sawt.lines;
        break;
      case 'qap':
        filename = 'bir-qap-lines';
        templateRow = {
          date: '',
          referenceNumber: '',
          payeeName: '',
          payeeTin: '',
          withholdingTaxTypeId: '',
          atcCode: '',
          withholdingTypeName: '',
          grossAmount: '',
          incomePayment: '',
          inputVat: '',
          rate: '',
          taxWithheld: '',
          netPayable: '',
        };
        rows = summary.attachments.qap.lines.map((line) => ({
          date: line.date,
          referenceNumber: line.referenceNumber,
          payeeName: line.payeeName,
          payeeTin: line.payeeTin,
          withholdingTaxTypeId: line.withholdingTaxTypeId || '',
          atcCode: line.atcCode,
          withholdingTypeName: line.withholdingTypeName || '',
          grossAmount: line.grossAmount ?? '',
          incomePayment: line.incomePayment,
          inputVat: line.inputVat ?? '',
          rate: line.rate,
          taxWithheld: line.taxWithheld,
          netPayable: line.netPayable ?? '',
        }));
        break;
    }

    this.downloadCsv(
      `${filename}-${summary.year}-q${summary.quarter}.csv`,
      rows.length ? rows : [templateRow]
    );
  }

  async downloadGimoStatement(type: 'sales' | 'purchases'): Promise<void> {
    const summary = this.filingSummary();
    if (!summary) return;

    try {
      if (type === 'sales') {
        await downloadGimoFinancialStatement(
          'sales',
          summary.attachments.slsp.sales as GimoSalesExportLine[],
          summary.year,
          summary.quarter,
        );
      } else {
        await downloadGimoFinancialStatement(
          'purchases',
          summary.attachments.slsp.purchases as GimoPurchaseExportLine[],
          summary.year,
          summary.quarter,
        );
      }
    } catch (err) {
      this.filingSummaryError.set(err instanceof Error ? err.message : 'Unable to export the GIMO statement.');
    }
  }

  selectedQuarterExpenseWarning(): string {
    return this.expenseComparisonWarning(
      this.selectedQuarterSalesReport(),
      this.selectedQuarterExpenseReport()
    );
  }

  expenseComparisonWarning(
    salesReport: QuarterlySalesReportRow | null | undefined,
    expenseReport: QuarterlyExpenseReportRow | null | undefined
  ): string {
    if (!salesReport || !expenseReport) {
      return '';
    }
    const salesTotal = Number(salesReport.totalAmount || 0);
    const expenseTotal = Number(expenseReport.totalAmount || 0);
    const difference = expenseTotal - salesTotal;
    if (salesTotal <= 0 || expenseTotal <= 0 || difference < -0.005) {
      return '';
    }
    const relation = Math.abs(difference) < 0.005 ? 'equal to' : 'greater than';
    return `Expense total is ${relation} sales total for ${this.quarterLabel(expenseReport.quarter)} ${expenseReport.year}. Review that expenses belong to the correct organization. Transfers automatically refresh affected saved expense reports.`;
  }

  matchingSalesReportForExpense(expenseReport: QuarterlyExpenseReportRow): QuarterlySalesReportRow | null {
    return (
      this.salesRows().find((row) =>
        row.organizationId === expenseReport.organizationId &&
        Number(row.year) === Number(expenseReport.year) &&
        Number(row.quarter) === Number(expenseReport.quarter)
      ) || null
    );
  }

  expenseReportWarning(expenseReport: QuarterlyExpenseReportRow): string {
    return this.expenseComparisonWarning(
      this.matchingSalesReportForExpense(expenseReport),
      expenseReport
    );
  }

  onFilterChange(): void {
    if (this.isContextLocked) return;
    this.salesPage = 1;
    this.expensePage = 1;
    this.persistTablePreferences();
    this.loadOrganizationTaxInfo();
    this.loadSalesReports();
    this.loadExpenseReports();
    this.loadBirFilingSummary();
  }

  onSalesPageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.salesPageSize = Number.isFinite(parsed) ? parsed : 20;
    this.salesPage = 1;
    this.persistTablePreferences();
    this.loadSalesReports();
  }

  onExpensePageSizeChange(value: string): void {
    if (this.isContextLocked) return;
    const parsed = Number(value);
    this.expensePageSize = Number.isFinite(parsed) ? parsed : 20;
    this.expensePage = 1;
    this.persistTablePreferences();
    this.loadExpenseReports();
  }

  setViewMode(mode: TableViewMode): void {
    if (this.isContextLocked) return;
    this.viewMode = mode;
    this.persistTablePreferences();
  }

  goToSalesPage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.salesTotalPages || page === this.salesPage || this.loadingSales()) {
      return;
    }
    this.salesPage = page;
    this.persistTablePreferences();
    this.loadSalesReports();
  }

  goToExpensePage(page: number): void {
    if (this.isContextLocked || page < 1 || page > this.expenseTotalPages || page === this.expensePage || this.loadingExpenses()) {
      return;
    }
    this.expensePage = page;
    this.persistTablePreferences();
    this.loadExpenseReports();
  }

  async deleteSalesReport(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const reportId = String(id || '').trim();
    if (!reportId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Sales Report',
      message: 'Delete this quarterly sales report? This action cannot be undone.',
      confirmText: 'Delete Report',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-trash3',
    });
    if (!confirmed) {
      return;
    }

    this.deletingSalesReportId.set(reportId);
    this.salesError.set('');
    this.salesMessage.set('');
    this.api.remove('/api/v1/reports/quarterly-sales', reportId).subscribe({
      next: (response) => {
        this.deletingSalesReportId.set('');
        this.salesMessage.set(response.message || 'Quarterly sales report deleted successfully.');
        this.loadSalesReports();
        this.loadBirFilingSummary();
      },
      error: (err) => {
        this.deletingSalesReportId.set('');
        this.salesError.set(err?.error?.message || 'Unable to delete sales report.');
      },
    });
  }

  async deleteExpenseReport(id: string): Promise<void> {
    if (this.isContextLocked) return;
    const reportId = String(id || '').trim();
    if (!reportId) {
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Expense Report',
      message: 'Delete this quarterly expense report? This action cannot be undone.',
      confirmText: 'Delete Report',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-trash3',
    });
    if (!confirmed) {
      return;
    }

    this.deletingExpenseReportId.set(reportId);
    this.expenseError.set('');
    this.expenseMessage.set('');
    this.api.remove('/api/v1/reports/quarterly-expenses', reportId).subscribe({
      next: (response) => {
        this.deletingExpenseReportId.set('');
        this.expenseMessage.set(response.message || 'Quarterly expense report deleted successfully.');
        this.loadExpenseReports();
        this.loadBirFilingSummary();
      },
      error: (err) => {
        this.deletingExpenseReportId.set('');
        this.expenseError.set(err?.error?.message || 'Unable to delete expense report.');
      },
    });
  }

  quarterLabel(quarter: number): string {
    return `Q${quarter}`;
  }

  trackById(_index: number, row: { id: string }): string {
    return row.id;
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

  private downloadCsv(filename: string, rows: Array<Record<string, string | number>>): void {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const escape = (value: string | number) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private getCurrentQuarter(): number {
    return Math.floor(new Date().getMonth() / 3) + 1;
  }

  private findSelectedSalesReport(rows: QuarterlySalesReportRow[]): QuarterlySalesReportRow | null {
    return (
      rows.find(
        (row) => Number(row.year) === this.selectedYear() && Number(row.quarter) === this.selectedQuarter()
      ) || null
    );
  }

  private findSelectedExpenseReport(rows: QuarterlyExpenseReportRow[]): QuarterlyExpenseReportRow | null {
    return (
      rows.find(
        (row) => Number(row.year) === this.selectedYear() && Number(row.quarter) === this.selectedQuarter()
      ) || null
    );
  }

  private restoreTablePreferences(): void {
    const prefs = loadTablePreferences(this.tablePrefsKey);
    this.viewMode = toTableViewMode(prefs['viewMode'], this.viewMode);
    this.salesPage = toPositiveInt(prefs['salesPage'], this.salesPage);
    this.salesPageSize = toPositiveInt(prefs['salesPageSize'], this.salesPageSize);
    this.expensePage = toPositiveInt(prefs['expensePage'], this.expensePage);
    this.expensePageSize = toPositiveInt(prefs['expensePageSize'], this.expensePageSize);
  }

  private persistTablePreferences(): void {
    saveTablePreferences(this.tablePrefsKey, {
      viewMode: this.viewMode,
      salesPage: this.salesPage,
      salesPageSize: this.salesPageSize,
      expensePage: this.expensePage,
      expensePageSize: this.expensePageSize,
    });
  }
}
