import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';

export interface TaxReturnPreparation {
  form: string | null;
  supported: boolean;
  reason: string;
  year: number;
  quarter: number;
  sourceRevision: string;
  rate: number;
  individual: boolean;
  possibleEightPercentElection: boolean;
  unclassifiedSales: number;
  defaults: Record<string, string | number | boolean>;
}

@Component({
  selector: 'app-bir-tax-return', standalone: true,
  imports: [CommonModule, FormsModule], templateUrl: './bir-tax-return.component.html',
})
export class BirTaxReturnComponent implements OnChanges, OnDestroy {
  @Input() preparation: TaxReturnPreparation | null = null;
  @Input() organizationId = '';
  @Input() canGenerate = false;
  @ViewChild('pdfFrame') pdfFrame?: ElementRef<HTMLIFrameElement>;
  readonly generating = signal(false);
  readonly error = signal('');
  readonly preview = signal<SafeResourceUrl | null>(null);
  readonly loaded = signal(false);
  details: Record<string, string | number | boolean> = {};
  private objectUrl = '';
  private request?: Subscription;
  private revision = 0;

  readonly identityFields = [
    { key: 'tin', label: 'TIN and branch code' }, { key: 'rdoCode', label: 'RDO code (3 digits)' },
    { key: 'registeredName', label: 'Registered taxpayer name' }, { key: 'registeredAddress', label: 'Registered address' },
    { key: 'zipCode', label: 'ZIP code' }, { key: 'phone', label: 'Contact number' }, { key: 'email', label: 'Email address' },
  ];
  readonly vatFields = [
    { key: 'vatableSales', label: '31A VATable sales' }, { key: 'zeroRatedSales', label: '32A Zero-rated sales' },
    { key: 'exemptSales', label: '33A Exempt sales' }, { key: 'outputVat', label: '31B Output VAT' },
    { key: 'domesticPurchases', label: '44A Domestic purchases, excluding VAT' }, { key: 'domesticInputVat', label: '44B Claimable domestic input VAT' },
    { key: 'purchasesWithoutInputVat', label: '48A Domestic purchases without input VAT' },
  ];
  readonly vatAdjustmentFields = [
    { key: 'inputCarryover', label: '38 Input VAT carried over' }, { key: 'transitionalInput', label: '40 Transitional input VAT' },
    { key: 'presumptiveInput', label: '41 Presumptive input VAT' },
    { key: 'nonresidentPurchases', label: '45A Nonresident services' }, { key: 'nonresidentInputVat', label: '45B Nonresident services input VAT' },
    { key: 'importPurchases', label: '46A Importations' }, { key: 'importInputVat', label: '46B Importation input VAT' },
    { key: 'exemptImports', label: '49A VAT-exempt importations' },
    { key: 'uncollectedOutputVat', label: '35 Output VAT on qualifying uncollected receivables' },
    { key: 'recoveredOutputVat', label: '36 Output VAT on recovered receivables' },
    { key: 'exemptInputVat', label: '53 Input VAT attributable to exempt sales' }, { key: 'refundInputVat', label: '54 VAT refund/TCC claimed' },
    { key: 'unpaidInputVat', label: '55 Input VAT on qualifying unpaid payables' },
    { key: 'advanceVat', label: '17 Advance VAT payments' },
  ];
  readonly creditFields = [
    { key: 'creditableTax', label: 'Creditable business tax withheld (not income-tax EWT)' },
    { key: 'previousPayment', label: 'Tax paid on the previous return (amended only)' },
    { key: 'otherCredits', label: 'Other credits/payments' }, { key: 'surcharge', label: 'Surcharge' },
    { key: 'interest', label: 'Interest' }, { key: 'compromise', label: 'Compromise penalty' },
  ];

  get recordedSales(): number { return Number(this.preparation?.defaults['percentageSales'] || 0); }

  constructor(private readonly api: ApiService, private readonly sanitizer: DomSanitizer) {}

  ngOnChanges(): void {
    this.request?.unsubscribe();
    this.revision++;
    this.generating.set(false);
    this.clearPreview();
    this.error.set('');
    this.details = { ...this.preparation?.defaults };
  }

  update(key: string, value: string | number | boolean): void {
    this.request?.unsubscribe();
    this.revision++;
    this.generating.set(false);
    this.details[key] = value;
    this.clearPreview();
    this.error.set('');
  }

  generate(): void {
    const prep = this.preparation;
    if (!prep?.supported || !this.canGenerate || !this.organizationId || this.generating()) return;
    this.clearPreview();
    this.error.set('');
    this.generating.set(true);
    const revision = ++this.revision;
    const params = new URLSearchParams({ organizationId: this.organizationId });
    this.request = this.api.generatePdf(`/api/v1/reports/bir-tax-return/pdf?${params}`, {
      year: prep.year, quarter: prep.quarter, sourceRevision: prep.sourceRevision, details: { ...this.details },
    }).subscribe({
      next: blob => {
        this.generating.set(false);
        this.objectUrl = URL.createObjectURL(blob);
        // Only a local URL created from the authenticated PDF response is trusted.
        this.preview.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
      },
      error: async err => {
        let message = 'Unable to generate the BIR PDF.';
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
    if (!this.objectUrl || !this.preparation) return;
    const link = document.createElement('a');
    link.href = this.objectUrl;
    link.download = `bir-${this.preparation.form}-${this.preparation.year}-q${this.preparation.quarter}.pdf`;
    link.click();
  }

  print(): void {
    const frame = this.pdfFrame?.nativeElement.contentWindow;
    try { frame?.focus(); frame?.print(); } catch { this.open(); }
  }

  open(): void { if (this.objectUrl) window.open(this.objectUrl, '_blank', 'noopener'); }

  private clearPreview(): void {
    this.preview.set(null);
    this.loaded.set(false);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.revision++;
    this.clearPreview();
  }
}
