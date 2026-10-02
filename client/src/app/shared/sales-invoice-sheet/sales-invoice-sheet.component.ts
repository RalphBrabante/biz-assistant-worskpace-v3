import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, inject } from '@angular/core';

export interface InvoiceDocument {
  version: number;
  seller: { name: string; address: string; taxId: string; phone: string };
  buyer: { name: string; address: string; taxId: string; businessStyle: string };
  terms: string; oscaPwdId: string; orderNumber: string; partial: boolean;
  items: { quantity: number; unit: string; name: string; description: string; unitPrice: number; amount: number }[];
  grossSales: number; tax: number; netSales: number; vatableSales: number | null;
  vatExemptSales: number | null; zeroRatedSales: number | null; scPwdDiscount: number;
  shipping: number; roundingAdjustment: number; withholding: number; total: number;
}
export interface PrintableInvoice {
  invoiceNumber: string; issueDate: string; dueDate?: string; currency?: string; status?: string; notes?: string;
  invoiceDocument?: InvoiceDocument | null;
}
@Component({
  selector: 'app-sales-invoice-sheet', standalone: true, imports: [CommonModule],
  templateUrl: './sales-invoice-sheet.component.html', styleUrl: './sales-invoice-sheet.component.css',
})
export class SalesInvoiceSheetComponent implements AfterViewInit {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  ngAfterViewInit(): void {
    if (this.preview) {
      this.element.nativeElement.querySelector<HTMLElement>('article')?.focus();
      this.element.nativeElement.scrollIntoView({ block: 'start' });
    }
  }
  @Input({ required: true }) invoice!: PrintableInvoice;
  @Input() preview = false;
  get blankRows(): number[] { return Array.from({ length: Math.max(0, 10 - (this.invoice.invoiceDocument?.items.length || 0)) }, (_, i) => i); }
  money(value: number | null): string { return value == null ? '—' : Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
}
