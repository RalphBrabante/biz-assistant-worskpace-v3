import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { ModalDirective } from '../../../shared/modal.directive';

interface BoardOrder {
  id: string; orderNumber: string; status: string; revision: number; currency: string; totalAmount: number;
  promisedDate?: string; customerPoNumber?: string; paymentStatus: string; fulfillmentStatus: string;
  invoicingStatus: string; organization?: { name: string }; customer?: { name: string };
  user?: { firstName: string; lastName: string };
  workflow?: { approval: string; poRequired: boolean; po?: { status?: string } };
}
interface Column { id: string; name: string; description: string; color: string; rows: BoardOrder[]; total: number; page: number; loading: boolean; error: string; }
const STAGES = [
  { id: 'draft', name: 'Draft', description: 'Prepare items and terms', color: 'slate' },
  { id: 'pending', name: 'Pending approval', description: 'Review before confirmation', color: 'amber' },
  { id: 'confirmed', name: 'Confirmed', description: 'Ready to begin work', color: 'blue' },
  { id: 'processing', name: 'Processing', description: 'Delivery or service in progress', color: 'violet' },
  { id: 'completed', name: 'Completed', description: 'Delivery or service complete', color: 'green' },
  { id: 'cancelled', name: 'Cancelled', description: 'Closed without fulfillment', color: 'rose' },
  { id: 'refunded', name: 'Refunded · legacy', description: 'Historical orders; new refunds use Payments', color: 'slate' },
];
const MOVES: Record<string, Record<string, string>> = {
  draft: { pending: 'submit', confirmed: 'confirm', cancelled: 'cancel' },
  pending: { draft: 'return_to_draft', confirmed: 'confirm', cancelled: 'cancel' },
  confirmed: { processing: 'start_processing', completed: 'complete', cancelled: 'cancel' },
  processing: { completed: 'complete', cancelled: 'cancel' },
};
@Component({ selector: 'app-order-board', standalone: true, imports: [CommonModule, FormsModule, RouterLink, ModalDirective],
  templateUrl: './order-board.component.html', styleUrl: './order-board.component.css' })
export class OrderBoardComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  @Input() organizationId = '';
  @Input() search = '';
  @Input() status = '';
  @Input() payment = '';
  @Input() queue = '';
  @Input() refreshKey = 0;
  @Output() totalChange = new EventEmitter<number>(true);
  @Output() busyChange = new EventEmitter<boolean>();
  columns: Column[] = [];
  dragged: BoardOrder | null = null;
  dropTarget = '';
  movingId = '';
  selected: BoardOrder | null = null;
  targetStatus = '';
  reason = '';
  error = '';
  notice = '';
  private reads = new Subscription();
  private write?: Subscription;
  private generation = 0;
  get busy(): boolean { return !!this.movingId || this.columns.some(column => column.loading); }
  get modalTargets(): Column[] { return this.selected ? this.columns.filter(column => this.canMove(this.selected!, column.id)) : []; }
  ngOnChanges(): void { this.selected = null; this.notice = ''; this.error = ''; this.load(); }
  ngOnDestroy(): void { this.generation++; this.reads.unsubscribe(); this.write?.unsubscribe(); }
  private params(status: string, page: number): URLSearchParams {
    const params = new URLSearchParams({ status, page: String(page), limit: '20' });
    if (this.organizationId) params.set('organizationId', this.organizationId);
    if (this.search.trim()) params.set('q', this.search.trim());
    if (this.payment) params.set('paymentStatus', this.payment);
    if (this.queue) params.set('view', this.queue);
    return params;
  }
  load(): void {
    this.generation++; this.reads.unsubscribe(); this.reads = new Subscription(); this.endDrag();
    this.columns = STAGES.map(stage => ({ ...stage, rows: [], total: 0, page: 0, loading: false, error: '' }));
    this.totalChange.emit(0);
    for (const column of this.columns) if (!this.status || column.id === this.status) this.readColumn(column, 1);
  }
  private readColumn(column: Column, page: number): void {
    const generation = this.generation; column.loading = true; column.error = '';
    this.reads.add(this.api.getFresh<BoardOrder[]>(`/api/v1/orders?${this.params(column.id, page)}`).subscribe({
      next: response => {
        if (generation !== this.generation) return;
        column.loading = false;
        const ids = new Set(page === 1 ? [] : column.rows.map(row => row.id));
        column.rows = [...(page === 1 ? [] : column.rows), ...(response.data || []).filter(row => !ids.has(row.id))];
        column.total = Number(response.meta?.total || 0); column.page = page;
        this.totalChange.emit(this.columns.reduce((sum, item) => sum + item.total, 0));
        if (page > 1 && !response.data?.length && column.rows.length < column.total) this.load();
      },
      error: error => { if (generation !== this.generation) return; column.loading = false; column.error = error?.error?.message || 'Unable to load orders in this column.'; },
    }));
  }
  more(column: Column): void { if (!column.loading && !this.movingId) this.readColumn(column, column.page + 1); }
  retry(column: Column): void { if (!column.loading && !this.movingId) this.readColumn(column, column.page ? column.page + 1 : 1); }
  canMove(order: BoardOrder, status: string): boolean { return !!order.workflow && this.auth.hasPermission('orders.update') && !!MOVES[order.status]?.[status]; }
  movable(order: BoardOrder): boolean { return !!order.workflow && this.auth.hasPermission('orders.update') && !!MOVES[order.status]; }
  startDrag(event: DragEvent, order: BoardOrder): void {
    if (this.busy || !this.movable(order) || this.selected) { event.preventDefault(); return; }
    this.dragged = order;
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', order.id); }
  }
  dragOver(event: DragEvent, column: Column): void {
    if (!this.dragged || this.busy || !this.canMove(this.dragged, column.id)) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; this.dropTarget = column.id;
  }
  dragLeave(event: DragEvent, column: Column): void {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node) && this.dropTarget === column.id) this.dropTarget = '';
  }
  drop(event: DragEvent, column: Column): void {
    event.preventDefault(); const order = this.dragged; this.endDrag();
    if (order && !this.busy && this.canMove(order, column.id)) {
      if (column.id === 'cancelled') this.openMove(order, column.id);
      else { this.reason = ''; this.move(order, column.id); }
    }
  }
  endDrag(): void { this.dragged = null; this.dropTarget = ''; }
  openMove(order: BoardOrder, target = ''): void {
    if (this.busy || !this.movable(order)) return;
    this.selected = order; this.targetStatus = target || Object.keys(MOVES[order.status])[0]; this.reason = ''; this.error = ''; this.notice = '';
  }
  @HostListener('document:keydown.escape') close(): void { if (!this.movingId) this.selected = null; }
  saveMove(): void { if (this.selected) this.move(this.selected, this.targetStatus); }
  move(order: BoardOrder, target: string): void {
    if (this.busy || !this.canMove(order, target)) return;
    if (target === 'cancelled' && !this.reason.trim()) { this.error = 'Enter a cancellation reason.'; return; }
    this.perform(order, MOVES[order.status][target], this.columns.find(column => column.id === target)?.name || target);
  }
  approve(order: BoardOrder): void {
    if (this.busy || order.workflow?.approval !== 'pending' || order.status !== 'pending' || !this.auth.hasPermission('orders.approve')) return;
    this.reason = ''; this.perform(order, 'approve', 'approved');
  }
  private perform(order: BoardOrder, action: string, destination: string): void {
    const generation = this.generation;
    this.movingId = order.id; this.busyChange.emit(true); this.error = ''; this.notice = '';
    // Keep the card in its source column until the workflow action is committed.
    this.write = this.api.create<BoardOrder>(`/api/v1/orders/${order.id}/actions`, { action, revision: order.revision, note: this.reason.trim() || undefined }).subscribe({
      next: () => {
        this.movingId = ''; this.busyChange.emit(false);
        if (generation !== this.generation) { this.load(); return; }
        this.selected = null; this.notice = action === 'approve' ? `${order.orderNumber} approved. It can now be confirmed once any required PO is verified.` : `${order.orderNumber} moved to ${destination}.`;
        this.load();
      },
      error: error => {
        this.movingId = ''; this.busyChange.emit(false);
        if (generation !== this.generation) return;
        this.error = error?.error?.message || 'The move could not be saved. The order has not moved.';
        if (error?.status === 409) { this.selected = null; this.load(); }
      },
    });
  }
  money(order: BoardOrder): string { try { return new Intl.NumberFormat('en', { style: 'currency', currency: order.currency }).format(Number(order.totalAmount)); } catch { return `${order.currency} ${Number(order.totalAmount).toFixed(2)}`; } }
  label(value: string): string { return (value || '').replace(/_/g, ' '); }
  overdue(order: BoardOrder): boolean { return !!order.promisedDate && order.promisedDate < new Date().toLocaleDateString('en-CA') && ['confirmed', 'processing'].includes(order.status) && order.fulfillmentStatus !== 'fulfilled'; }
  trackColumn(_index: number, column: Column): string { return column.id; }
  trackOrder(_index: number, order: BoardOrder): string { return order.id; }
}
