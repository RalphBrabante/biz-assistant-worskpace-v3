import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export interface DeliveryReceiptItem { lineId: string; quantity: number; unit: string; name: string; description?: string; }
export interface DeliveryReceiptDocument {
  version: number;
  seller: { name: string; address: string; taxId: string; phone: string; vatRegistered?: boolean };
  deliveredTo: string; address: string; taxId: string; businessStyle: string; terms: string; poNumber: string;
  deliveredBy: string; preparedBy: string; orderNumber: string; items: DeliveryReceiptItem[];
}
export interface DeliveryReceipt {
  id: string; receiptNumber: string; deliveryDate: string; status: string; voidReason?: string | null; createdAt?: string;
  receiptDocument: DeliveryReceiptDocument | null;
}
@Component({
  selector: 'app-delivery-receipt-sheet', standalone: true, imports: [CommonModule],
  templateUrl: './delivery-receipt-sheet.component.html', styleUrl: './delivery-receipt-sheet.component.css',
})
export class DeliveryReceiptSheetComponent {
  @Input({ required: true }) receipt!: DeliveryReceipt;
  // The paper form has 18 article rows; short receipts keep the same look.
  get blankRows(): number[] { return Array.from({ length: Math.max(0, 18 - (this.receipt.receiptDocument?.items.length || 0)) }, (_, i) => i); }
  quantity(value: number): string { return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 }); }
}
