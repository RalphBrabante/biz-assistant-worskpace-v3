import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlphalistDraft, AlphalistKind, BIR_ALPHALIST_VERSION, BIR_FORMAT_VERIFIED_ON, createAlphalistDraft, downloadAlphalistDat, downloadReviewedAlphalistExcel } from '../core/bir-alphalist-dat';
import { WithholdingLine } from '../core/bir-alphalist-export';
import { SalesReportRow } from '../core/sales-report-export';
@Component({
  selector: 'app-bir-alphalist-export', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './bir-alphalist-export.component.html',
})
export class BirAlphalistExportComponent implements OnChanges {
  @Input() kind: AlphalistKind = 'expenses';
  @Input() report: SalesReportRow | null = null;
  @Input() lines: WithholdingLine[] = [];
  @Input() disabled = false;
  @ViewChild('exportDialog') dialog?: ElementRef<HTMLDialogElement>;
  draft: AlphalistDraft | null = null;
  opened = false; exporting = false; error = '';
  readonly version = BIR_ALPHALIST_VERSION;
  readonly verifiedOn = BIR_FORMAT_VERIFIED_ON;
  ngOnChanges(): void {
    this.close(); this.error = '';
    this.draft = this.report && !this.disabled ? createAlphalistDraft(this.kind, this.report, this.lines) : null;
  }
  toggle(): void {
    if (this.opened) this.close();
    else if (this.draft && !this.disabled) { this.dialog?.nativeElement.showModal(); this.opened = true; }
  }
  close(): void { this.dialog?.nativeElement.close(); this.opened = false; }
  changed(): void { if (this.draft) this.draft.reviewed = false; this.error = ''; }
  async download(format: 'dat' | 'excel'): Promise<void> {
    if (!this.report || !this.draft || this.disabled || this.exporting) return;
    this.exporting = true; this.error = '';
    try {
      if (format === 'dat') await downloadAlphalistDat(this.kind, this.report, this.draft);
      else await downloadReviewedAlphalistExcel(this.kind, this.report, this.draft);
    } catch (err) { this.error = err instanceof Error ? err.message : 'Unable to export the BIR attachment.'; }
    finally { this.exporting = false; }
  }
}
