import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { DeliveryReceipt, DeliveryReceiptSheetComponent } from '../../shared/delivery-receipt-sheet/delivery-receipt-sheet.component';

interface OrderWithReceipts { id: string; orderNumber: string; deliveryReceipts?: DeliveryReceipt[]; }

@Component({
  selector: 'app-delivery-receipt-page', standalone: true, imports: [CommonModule, RouterLink, DeliveryReceiptSheetComponent],
  templateUrl: './delivery-receipt-page.component.html',
})
export class DeliveryReceiptPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly subscriptions = new Subscription();
  readonly receipt = signal<DeliveryReceipt | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  orderId = '';

  ngOnInit(): void {
    this.subscriptions.add(this.route.paramMap.subscribe(params => {
      this.orderId = params.get('id') || '';
      const receiptId = params.get('receiptId') || '';
      this.loading.set(true); this.error.set(''); this.receipt.set(null);
      this.subscriptions.add(this.api.getFresh<OrderWithReceipts>(`/api/v1/orders/${this.orderId}`).subscribe({
        next: response => {
          const found = response.data?.deliveryReceipts?.find(receipt => receipt.id === receiptId) || null;
          this.receipt.set(found); this.loading.set(false);
          if (!found) this.error.set('This delivery receipt was not found on the order.');
        },
        error: err => { this.loading.set(false); this.error.set(err?.error?.message || 'Unable to load the delivery receipt.'); },
      }));
    }));
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); }
  print(): void { window.print(); }
}
