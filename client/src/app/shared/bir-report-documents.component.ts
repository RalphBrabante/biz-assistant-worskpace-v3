import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { BirTaxReturnComponent, TaxReturnPreparation } from './bir-tax-return.component';

export interface ReportDocumentField {
  key: string;
  label: string;
  type: 'text' | 'amount' | 'signedAmount' | 'select' | 'checkbox' | 'date' | 'year';
  group: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}
export interface ReportDocumentPreparation {
  id: string;
  title: string;
  category: string;
  year: number;
  quarter: number | null;
  annual: boolean;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  supported: boolean;
  reason: string;
  sourceRevision: string;
  description: string;
  warnings: string[];
  fields: ReportDocumentField[];
  defaults: Record<string, string | number | boolean>;
  officialUrl?: string;
  lineCount?: number;
  recipients?: Array<{ key: string; name: string; tin: string; address: string; zip: string }>;
}

@Component({
  selector: 'app-bir-report-documents', standalone: true,
  imports: [CommonModule, FormsModule, BirTaxReturnComponent],
  templateUrl: './bir-report-documents.component.html',
})
export class BirReportDocumentsComponent implements OnChanges, OnDestroy {
  @Input() documents: ReportDocumentPreparation[] = [];
  @Input() businessTax: TaxReturnPreparation | null = null;
  @Input() organizationId = '';
  @Input() canGenerate = false;
  @Input() initialDocumentId = 'business';
  @Output() exportCsv = new EventEmitter<'sawt' | 'qap'>();
  @Output() exportXlsx = new EventEmitter<'sales' | 'purchases'>();
  @Output() pdfSaved = new EventEmitter<void>();
  @ViewChild('pdfFrame') pdfFrame?: ElementRef<HTMLIFrameElement>;
  selectedId = 'business';
  readonly categories = ['Income tax returns', 'Withholding documents', 'Supporting schedules', 'Transaction reports'];
  readonly groups = [{ key: 'identity', label: 'Registered details' }, { key: 'income', label: 'Tax computation' }, { key: 'credits', label: 'Credits, payments and penalties' }, { key: 'review', label: 'Review before generating' }];
  readonly generating = signal(false);
  readonly error = signal('');
  readonly preview = signal<SafeResourceUrl | null>(null);
  readonly loaded = signal(false);
  details: Record<string, string | number | boolean> = {};
  private objectUrl = '';
  private request?: Subscription;
  private revision = 0;

  constructor(private readonly api: ApiService, private readonly sanitizer: DomSanitizer) {}

  get selected(): ReportDocumentPreparation | undefined { return this.documents.find(doc => doc.id === this.selectedId); }
  categoryDocuments(category: string): ReportDocumentPreparation[] { return this.documents.filter(doc => doc.category === category); }
  fields(group: string): ReportDocumentField[] {
    return (this.selected?.fields || []).filter(field => field.group === group && this.visible(field.key));
  }
  private visible(key: string): boolean {
    if (this.selectedId === '1701Q') {
      const eight = this.details['incomeTaxElection'] === 'eight_percent';
      if (['deductionMethod', 'costSales', 'deductions', 'priorIncome'].includes(key)) return !eight;
      if (['eightPercentEligible', 'priorGrossIncome'].includes(key)) return eight;
    }
    if (['totalAssets', 'eligibleSmallCorporation'].includes(key)) return this.details['corporateRate'] === '20';
    return true;
  }

  ngOnChanges(changes?: SimpleChanges): void {
    if (changes?.['initialDocumentId']) this.selectedId = this.initialDocumentId;
    if (this.selectedId !== 'business' && !this.selected) this.selectedId = 'business';
    this.reset();
  }
  select(id: string): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.reset();
  }
  private reset(): void {
    this.cancelPreview();
    this.details = { ...this.selected?.defaults };
  }
  update(key: string, value: string | number | boolean): void {
    this.cancelPreview();
    this.details[key] = value;
    if (key === 'recipientKey') {
      const recipient = this.selected?.recipients?.find(row => row.key === value);
      if (recipient) Object.assign(this.details, { payeeName: recipient.name, payeeTin: recipient.tin, payeeAddress: recipient.address, payeeZip: recipient.zip, reviewedAmounts: false });
    }
    if (key === 'deductionMethod' && value === 'osd' && this.selectedId === '1701Q') this.details['costSales'] = 0;
    // Any change to amounts invalidates the previous review confirmation.
    if (!['reviewedAmounts', 'verifiedCredits'].includes(key) && this.selected?.fields.some(field => field.key === 'reviewedAmounts')) this.details['reviewedAmounts'] = false;
    if (['currentWithholding', 'priorWithholding'].includes(key)) this.details['verifiedCredits'] = false;
  }

  generate(): void {
    const prep = this.selected;
    if (!prep?.supported || !this.canGenerate || !this.organizationId || this.generating()) return;
    this.cancelPreview();
    this.generating.set(true);
    const revision = this.revision;
    const params = new URLSearchParams({ organizationId: this.organizationId });
    this.request = this.api.generatePdf(`/api/v1/reports/bir-document/pdf?${params}`, {
      documentId: prep.id, year: prep.year, quarter: prep.quarter,
      sourceRevision: prep.sourceRevision, details: { ...this.details },
    }).subscribe({
      next: blob => {
        if (revision !== this.revision) return;
        this.generating.set(false);
        this.objectUrl = URL.createObjectURL(blob);
        this.preview.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
        this.pdfSaved.emit();
      },
      error: async err => {
        let message = 'Unable to generate the report PDF.';
        if (err?.error instanceof Blob) {
          try { message = JSON.parse(await err.error.text()).message || message; } catch {}
        } else message = err?.error?.message || message;
        if (revision !== this.revision) return;
        this.generating.set(false);
        this.error.set(message);
      },
    });
  }
  download(): void {
    if (!this.objectUrl || !this.selected) return;
    const link = document.createElement('a'); link.href = this.objectUrl;
    link.download = `bir-${this.selected.id}-${this.selected.year}-${this.selected.annual ? 'annual' : `q${this.selected.quarter}`}.pdf`;
    link.click();
  }
  print(): void {
    try {
      const frame = this.pdfFrame?.nativeElement.contentWindow;
      if (!frame) return this.open();
      frame.focus(); frame.print();
    } catch { this.open(); }
  }
  open(): void { if (this.objectUrl) window.open(this.objectUrl, '_blank', 'noopener'); }

  private cancelPreview(): void {
    this.request?.unsubscribe();
    this.revision++;
    this.generating.set(false); this.error.set(''); this.preview.set(null); this.loaded.set(false);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
  }
  ngOnDestroy(): void { this.cancelPreview(); }
}
