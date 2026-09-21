import { ModalDirective } from '../../shared/modal.directive';
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AbstractControl, FormsModule, ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { ApiResponse } from '../../core/types';

interface ItemRow {
  id: string;
  organizationId: string;
  type?: string;
  name: string;
  sku?: string;
  category?: string;
  price?: number;
  discountedPrice?: number;
  taxRate?: number;
  stock?: number;
  currency?: string;
  isActive?: boolean;
}

interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  taxId: string;
  isActive?: boolean;
}

interface OrderSnapshotRow {
  id: string;
  itemId?: string;
  type?: string;
  sku?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  currency?: string;
  unitPrice?: number;
  discountedUnitPrice?: number;
  taxRate?: number;
  lineSubtotal?: number;
  lineDiscount?: number;
  lineTax?: number;
  lineTotal?: number;
}

interface OrderActivityRow {
  id: string;
  actionType?: string;
  title?: string;
  description?: string;
  changedFields?: string[];
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  actor?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
}

interface OrderRow {
  id: string;
  organizationId: string;
  currency?: string;
  orderNumber: string;
  createdAt?: string;
  dueDate?: string;
  customerId?: string;
  customer?: {
    id: string;
    name?: string;
    taxId?: string;
  };
  status?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  withHoldingTaxAmount?: number;
  withholdingTaxTypeId?: string | null;
  discountAmount?: number;
  totalAmount?: number;
  shippingAmount?: number;
  notes?: string;
  orderedItemSnapshots?: OrderSnapshotRow[];
  activities?: OrderActivityRow[];
  withholdingTaxType?: {
    id: string;
    code?: string;
    name?: string;
    percentage?: number;
    appliesTo?: 'expense' | 'invoice' | 'both';
  };
}

interface CartItem {
  item: ItemRow;
  quantity: number;
}

interface WithholdingTaxTypeOption {
  id: string;
  code?: string;
  name?: string;
  percentage?: number;
  appliesTo?: 'expense' | 'invoice' | 'both';
  isActive?: boolean;
}

@Component({
  selector: 'app-order-preview-page',
  standalone: true,
  imports: [ModalDirective, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, TooltipDirective],
  templateUrl: './order-preview-page.component.html',
})
export class OrderPreviewPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly fb = inject(FormBuilder);

  orderId = '';
  order: OrderRow | null = null;
  loading = false;
  saving = false;
  error = '';
  message = '';

  status = 'pending';
  paymentStatus = 'unpaid';
  fulfillmentStatus = 'unfulfilled';
  shippingAmount = 0;
  notes = '';

  customerSearchQuery = '';
  customerResults: CustomerRow[] = [];
  selectedCustomerId = '';
  searchingCustomers = false;

  itemSearchQuery = '';
  catalogItems: ItemRow[] = [];
  catalogHasMore = false;
  catalogLoadingMore = false;
  private catalogCurrentLimit = 10;
  private readonly catalogInitialLimit = 10;
  private readonly catalogLoadMoreStep = 5;
  private catalogLookup = new Map<string, ItemRow>();
  catalogLoading = false;
  cart: CartItem[] = [];
  showCompleteModal = false;
  completeOrderForm = this.fb.group({
    salesInvoiceId: ['', [Validators.required, Validators.pattern(/^\d{4}$/)]],
    salesInvoiceIssueDate: [this.todayIsoDate(), [Validators.required]],
    dueDate: [this.todayIsoDate(), [Validators.required]],
  });
  completeFormSubmitted = false;
  completionModalError = '';
  organizationVatRate = 0;
  applyWithholdingTax = false;
  withholdingTaxTypeId = '';
  withholdingTaxTypes: WithholdingTaxTypeOption[] = [];
  loadingWithholdingTaxTypes = false;
  activityVisibleCount = 3;
  private readonly currencyFormatterCache = new Map<string, Intl.NumberFormat>();
  private readonly statusLabelMap: Record<string, string> = {
    pending: 'pending',
    confirmed: 'confirmed',
    refunded: 'refunded',
    completed: 'completed',
    cancelled: 'cancelled',
    processing: 'processing',
  };

  ngOnInit(): void {
    this.orderId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.orderId) {
      this.showError('Order ID is missing.');
      return;
    }
    this.loadOrder();
  }

  get isCompleted(): boolean {
    return String(this.order?.status || '').toLowerCase() === 'completed';
  }

  get isCancelled(): boolean {
    return String(this.order?.status || '').toLowerCase() === 'cancelled';
  }

  get isRefunded(): boolean {
    return String(this.order?.status || '').toLowerCase() === 'refunded';
  }

  get isFinalized(): boolean {
    return this.isCompleted || this.isRefunded || this.isCancelled;
  }

  get baseStatus(): string {
    return String(this.order?.status || '').toLowerCase();
  }

  get selectedStatusNormalized(): string {
    return String(this.status || '').toLowerCase();
  }

  get allowedStatusOptions(): string[] {
    const from = this.baseStatus;
    switch (from) {
      case 'pending':
        return ['pending', 'confirmed', 'cancelled'];
      case 'confirmed':
        return ['confirmed', 'processing', 'completed', 'cancelled'];
      case 'processing':
        return ['processing', 'completed', 'cancelled'];
      case 'completed':
        return ['completed', 'refunded'];
      case 'refunded':
        return ['refunded'];
      case 'cancelled':
        return ['cancelled'];
      default: {
        const fallback = this.selectedStatusNormalized || from || 'pending';
        return [fallback];
      }
    }
  }

  statusLabel(status: string): string {
    const normalized = String(status || '').toLowerCase();
    return this.statusLabelMap[normalized] || normalized || '-';
  }

  private isValidStatusTransition(fromRaw: string, toRaw: string): boolean {
    const from = String(fromRaw || '').toLowerCase();
    const to = String(toRaw || '').toLowerCase();
    if (!from || !to) {
      return false;
    }
    if (from === to) {
      return true;
    }
    if (from === 'pending') {
      return to === 'confirmed' || to === 'cancelled';
    }
    if (from === 'confirmed') {
      return to === 'processing' || to === 'completed' || to === 'cancelled';
    }
    if (from === 'processing') {
      return to === 'completed' || to === 'cancelled';
    }
    if (from === 'completed') {
      return to === 'refunded';
    }
    return false;
  }

  get isLocked(): boolean {
    const normalizedSelected = String(this.status || '').toLowerCase();
    return this.isFinalized || normalizedSelected === 'completed' || normalizedSelected === 'refunded' || normalizedSelected === 'cancelled';
  }

  get isOrderedItemsLocked(): boolean {
    const normalizedStatus = String(this.status || this.order?.status || '').toLowerCase();
    return normalizedStatus === 'processing' || normalizedStatus === 'confirmed' || normalizedStatus === 'completed' || normalizedStatus === 'refunded' || normalizedStatus === 'cancelled';
  }

  get organizationId(): string {
    return this.order?.organizationId || '';
  }

  get orderCurrency(): string {
    const explicit = String(this.order?.currency || '').trim();
    if (explicit) {
      return explicit.toUpperCase();
    }
    const snapshotCurrency = String(this.order?.orderedItemSnapshots?.[0]?.currency || '').trim();
    if (snapshotCurrency) {
      return snapshotCurrency.toUpperCase();
    }
    return 'USD';
  }

  formatMoney(value: unknown, currency?: string): string {
    const amount = Number(value ?? 0);
    const code = String(currency || this.orderCurrency || 'USD').toUpperCase();
    const normalizedAmount = Number.isFinite(amount) ? amount : 0;
    const formatter = this.currencyFormatterCache.get(code);
    if (formatter) {
      return formatter.format(normalizedAmount);
    }

    try {
      const created = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      this.currencyFormatterCache.set(code, created);
      return created.format(normalizedAmount);
    } catch (_err) {
      return `${code} ${normalizedAmount.toFixed(2)}`;
    }
  }

  loadOrder(): void {
    this.loading = true;
    this.error = '';
    this.message = '';
    this.activityVisibleCount = 3;
    // Keep item search pane intentionally empty until user searches (prevents noisy initial list).
    this.catalogItems = [];
    this.catalogHasMore = false;
    this.catalogLoadingMore = false;
    this.catalogCurrentLimit = this.catalogInitialLimit;

    this.api.get<OrderRow>(`/api/v1/orders/${this.orderId}`).subscribe({
      next: (response: ApiResponse<OrderRow>) => {
        this.loading = false;
        const order = response.data || null;
        this.order = order;
        if (!order) {
          this.showError('Order not found.');
          return;
        }

        this.status = String(order.status || 'pending');
        this.paymentStatus = String(order.paymentStatus || 'unpaid');
        this.fulfillmentStatus = String(order.fulfillmentStatus || 'unfulfilled');
        this.shippingAmount = Number(order.shippingAmount || 0);
        this.notes = String(order.notes || '');
        this.applyWithholdingTax = Boolean(order.withholdingTaxTypeId);
        this.withholdingTaxTypeId = String(order.withholdingTaxTypeId || '');
        this.selectedCustomerId = String(order.customerId || order.customer?.id || '');
        this.customerResults = order.customer ? [{ id: order.customer.id, organizationId: order.organizationId, name: order.customer.name || '', taxId: order.customer.taxId || '' }] : [];

        this.loadOrganizationTaxRate();
        this.loadWithholdingTaxTypes();
        this.loadItemsForOrganization();
      },
      error: (err) => {
        this.loading = false;
        this.showError(err?.error?.message || 'Unable to load order.');
      },
    });
  }

  loadOrganizationTaxRate(): void {
    if (!this.organizationId) {
      this.organizationVatRate = 0;
      return;
    }

    this.api.get<{ taxType?: { percentage?: number } }>(`/api/v1/organizations/${this.organizationId}`).subscribe({
      next: (response) => {
        const percentage = Number(response.data?.taxType?.percentage ?? NaN);
        if (Number.isFinite(percentage) && percentage > 0) {
          this.organizationVatRate = Number(percentage.toFixed(2));
          return;
        }
        this.organizationVatRate = this.derivedVatRateFromOrder();
      },
      error: () => {
        this.organizationVatRate = this.derivedVatRateFromOrder();
      },
    });
  }

  loadItemsForOrganization(): void {
    if (!this.organizationId) return;

    this.catalogLoading = true;
    this.api.list<ItemRow>(`/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&isActive=true&limit=300`).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.catalogLoading = false;
        const allItems = response.data || [];
        this.catalogLookup = new Map(allItems.map((item) => [item.id, item]));
        this.catalogItems = [];
        this.catalogHasMore = false;
        this.catalogCurrentLimit = this.catalogInitialLimit;
        this.initializeCartFromOrder();
      },
      error: (err) => {
        this.catalogLoading = false;
        this.showError(err?.error?.message || 'Unable to load items catalog.');
      },
    });
  }

  initializeCartFromOrder(): void {
    const snapshots = this.order?.orderedItemSnapshots || [];
    const byId = this.catalogLookup;
    this.cart = snapshots
      .map((row) => {
        const itemId = String(row.itemId || '');
        if (!itemId) return null;
        const liveItem = byId.get(itemId);
        // Keep historical snapshot pricing immutable in order details.
        // We still borrow live stock/type flags for validation and item behavior.
        const snapshotUnitPrice = Number(row.unitPrice ?? NaN);
        const snapshotDiscounted =
          row.discountedUnitPrice === null || row.discountedUnitPrice === undefined
            ? null
            : Number(row.discountedUnitPrice);
        const item = {
          id: itemId,
          organizationId: liveItem?.organizationId || this.organizationId,
          type: row.type || liveItem?.type || 'product',
          name: row.name || liveItem?.name || 'Unknown Item',
          sku: row.sku || liveItem?.sku || '',
          category: liveItem?.category,
          price: Number.isFinite(snapshotUnitPrice)
            ? snapshotUnitPrice
            : Number(liveItem?.price ?? 0),
          discountedPrice:
            snapshotDiscounted !== null && Number.isFinite(snapshotDiscounted)
              ? snapshotDiscounted
              : null,
          taxRate: Number(row.taxRate ?? liveItem?.taxRate ?? 0),
          stock: Number(liveItem?.stock ?? 0),
          currency: row.currency || liveItem?.currency || this.orderCurrency,
          isActive: liveItem?.isActive ?? true,
        } as ItemRow;
        return {
          item,
          quantity: Math.max(1, Number(row.quantity || 1)),
        } as CartItem;
      })
      .filter((row): row is CartItem => Boolean(row));
  }

  searchItems(): void {
    if (this.isOrderedItemsLocked) return;
    if (!this.organizationId) {
      this.showError('Order organization is missing.');
      return;
    }

    this.catalogLoading = true;
    this.error = '';
    // Reset to the first chunk for each new query (10 initial, then +5 via loadMoreItems).
    this.catalogCurrentLimit = this.catalogInitialLimit;
    const q = encodeURIComponent(this.itemSearchQuery.trim());
    this.api
      .list<ItemRow>(
        `/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&page=1&limit=${this.catalogCurrentLimit}`
      )
      .subscribe({
        next: (response: ApiResponse<ItemRow[]>) => {
          this.catalogLoading = false;
          const rows = response.data || [];
          this.catalogItems = rows;
          const total = Number(response.meta?.total || rows.length);
          this.catalogHasMore = this.catalogItems.length < total;
        },
        error: (err) => {
          this.catalogLoading = false;
          this.catalogHasMore = false;
          this.catalogItems = [];
          this.showError(err?.error?.message || 'Unable to search items.');
        },
      });
  }

  loadMoreItems(): void {
    if (this.isOrderedItemsLocked || this.catalogLoading || this.catalogLoadingMore || !this.catalogHasMore) {
      return;
    }

    this.catalogLoadingMore = true;
    this.error = '';
    // Uses growing limit on page 1 so previously loaded cards keep order and avoid duplicates.
    this.catalogCurrentLimit += this.catalogLoadMoreStep;
    const q = encodeURIComponent(this.itemSearchQuery.trim());
    this.api
      .list<ItemRow>(
        `/api/v1/items?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&page=1&limit=${this.catalogCurrentLimit}`
      )
      .subscribe({
        next: (response: ApiResponse<ItemRow[]>) => {
          this.catalogLoadingMore = false;
          const rows = response.data || [];
          this.catalogItems = rows;
          const total = Number(response.meta?.total || rows.length);
          this.catalogHasMore = this.catalogItems.length < total;
        },
        error: (err) => {
          this.catalogLoadingMore = false;
          this.showError(err?.error?.message || 'Unable to load more items.');
        },
      });
  }

  searchCustomers(): void {
    if (this.isLocked) return;
    if (!this.organizationId) {
      this.showError('Order organization is missing.');
      return;
    }

    this.searchingCustomers = true;
    this.error = '';

    const q = encodeURIComponent(this.customerSearchQuery.trim());
    const endpoint = `/api/v1/customers?organizationId=${encodeURIComponent(this.organizationId)}&q=${q}&isActive=true&limit=30`;

    this.api.list<CustomerRow>(endpoint).subscribe({
      next: (response: ApiResponse<CustomerRow[]>) => {
        this.searchingCustomers = false;
        this.customerResults = (response.data || []).filter((row) => row.isActive !== false);
      },
      error: (err) => {
        this.searchingCustomers = false;
        this.showError(err?.error?.message || 'Unable to search customers.');
      },
    });
  }

  addToCart(item: ItemRow): void {
    if (this.isOrderedItemsLocked) return;
    const existing = this.cart.find((entry) => entry.item.id === item.id);
    if (existing) {
      this.increase(item.id);
      return;
    }
    if (item.type === 'product' && this.maxStock(item) <= 0) {
      this.message = `Cannot add ${item.name}. No available stock.`;
      return;
    }
    this.cart.push({ item, quantity: 1 });
  }

  increase(itemId: string): void {
    if (this.isOrderedItemsLocked) return;
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;
    if (entry.item.type === 'product' && entry.quantity >= this.maxStock(entry.item)) {
      this.message = `Cannot add more of ${entry.item.name}. Reached available stock (${this.maxStock(entry.item)}).`;
      return;
    }
    entry.quantity += 1;
  }

  decrease(itemId: string): void {
    if (this.isOrderedItemsLocked) return;
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;
    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      this.removeFromCart(itemId);
    }
  }

  updateQuantity(itemId: string, value: unknown): void {
    if (this.isOrderedItemsLocked) return;
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    let nextQuantity = Math.trunc(parsed);
    if (nextQuantity < 1) {
      nextQuantity = 1;
    }

    if (entry.item.type === 'product') {
      const availableStock = this.maxStock(entry.item);
      if (availableStock <= 0) {
        this.message = `${entry.item.name} is currently out of stock.`;
      } else if (nextQuantity > availableStock) {
        this.message = `Quantity for ${entry.item.name} exceeds available stock (${availableStock}).`;
      }
    }

    entry.quantity = nextQuantity;
  }

  async removeFromCart(itemId: string): Promise<void> {
    if (this.isOrderedItemsLocked) return;
    const confirmed = await this.confirmDialog.confirm({
      title: 'Remove Item',
      message: 'Remove this item from the order cart?',
      confirmText: 'Remove',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-cart-x',
    });
    if (!confirmed) {
      return;
    }
    this.cart = this.cart.filter((row) => row.item.id !== itemId);
  }

  maxStock(item: ItemRow): number {
    return Math.max(0, Number(item.stock ?? 0));
  }

  itemUnitPrice(item: ItemRow): number {
    const discounted = Number(item.discountedPrice ?? NaN);
    if (Number.isFinite(discounted) && discounted >= 0) {
      return discounted;
    }
    return Number(item.price ?? 0);
  }

  get subtotalAmount(): number {
    const subtotal = this.cart.reduce((acc, row) => acc + this.itemUnitPrice(row.item) * row.quantity, 0);
    const computed = Number(subtotal.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.subtotalAmount || 0).toFixed(2));
  }

  get taxableAmount(): number {
    const rate = Number(this.organizationVatRate || 0);
    if (rate <= 0) {
      return this.subtotalAmount;
    }
    return Number((this.subtotalAmount / (1 + rate / 100)).toFixed(2));
  }

  get taxAmount(): number {
    const rate = Number(this.organizationVatRate || 0);
    if (rate <= 0) {
      return Number(Number(this.order?.taxAmount || 0).toFixed(2));
    }
    const computed = Number((this.taxableAmount * (rate / 100)).toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.taxAmount || 0).toFixed(2));
  }

  get discountAmount(): number {
    const discount = this.cart.reduce((acc, row) => {
      const full = Number(row.item.price ?? 0) * row.quantity;
      const effective = this.itemUnitPrice(row.item) * row.quantity;
      return acc + Math.max(0, full - effective);
    }, 0);
    const computed = Number(discount.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.discountAmount || 0).toFixed(2));
  }

  get totalAmount(): number {
    return Number((this.subtotalAmount + Number(this.shippingAmount || 0) - this.withHoldingTaxAmount).toFixed(2));
  }

  get selectedWithholdingTaxType(): WithholdingTaxTypeOption | undefined {
    return this.withholdingTaxTypes.find((row) => row.id === this.withholdingTaxTypeId);
  }

  get withHoldingTaxAmount(): number {
    if (!this.applyWithholdingTax || !this.withholdingTaxTypeId) {
      return 0;
    }
    const percentage = Number(this.selectedWithholdingTaxType?.percentage || 0);
    if (!Number.isFinite(percentage) || percentage <= 0) {
      return 0;
    }
    // UI mirrors backend rule: withholding is a percentage of taxable amount.
    return Number((this.taxableAmount * (percentage / 100)).toFixed(2));
  }

  get selectedCustomer(): CustomerRow | undefined {
    return this.customerResults.find((row) => row.id === this.selectedCustomerId);
  }

  get isPendingStatus(): boolean {
    return String(this.status || this.order?.status || '').toLowerCase() === 'pending';
  }

  get displayCustomerName(): string {
    return this.selectedCustomer?.name || this.order?.customer?.name || '-';
  }

  get displayCustomerTaxId(): string {
    return this.selectedCustomer?.taxId || this.order?.customer?.taxId || '-';
  }

  get deliveryLines(): OrderSnapshotRow[] {
    return this.order?.orderedItemSnapshots || [];
  }

  get activityHistory(): OrderActivityRow[] {
    return this.order?.activities || [];
  }

  get visibleActivityHistory(): OrderActivityRow[] {
    return this.activityHistory.slice(0, this.activityVisibleCount);
  }

  get hasMoreActivities(): boolean {
    return this.activityVisibleCount < this.activityHistory.length;
  }

  get printProductLines(): OrderSnapshotRow[] {
    return this.deliveryLines.filter((line) => {
      const snapshotType = String(line.type || '').toLowerCase();
      if (snapshotType) {
        return snapshotType === 'product';
      }
      const catalogType = String(this.catalogLookup.get(String(line.itemId || ''))?.type || '').toLowerCase();
      return catalogType === 'product';
    });
  }

  get deliverySubtotal(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get deliveryTax(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    const computed = Number(value.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.taxAmount || 0).toFixed(2));
  }

  get deliveryTaxable(): number {
    const taxable = this.deliverySubtotal - this.deliveryTax;
    return Number(Math.max(0, taxable).toFixed(2));
  }

  get deliveryDiscount(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    const computed = Number(value.toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.discountAmount || 0).toFixed(2));
  }

  get deliveryTotal(): number {
    const value = this.deliveryLines.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0);
    const computed = Number((value + Number(this.shippingAmount || 0)).toFixed(2));
    if (computed > 0) return computed;
    return Number(Number(this.order?.totalAmount || 0).toFixed(2));
  }

  get printSubtotal(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineSubtotal || 0), 0);
    return Number(value.toFixed(2));
  }

  get printTax(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineTax || 0), 0);
    return Number(value.toFixed(2));
  }

  get printTaxable(): number {
    const taxable = this.printSubtotal - this.printTax;
    return Number(Math.max(0, taxable).toFixed(2));
  }

  get printDiscount(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineDiscount || 0), 0);
    return Number(value.toFixed(2));
  }

  get printTotal(): number {
    const value = this.printProductLines.reduce((acc, row) => acc + Number(row.lineTotal || 0), 0);
    return Number((value + Number(this.shippingAmount || 0)).toFixed(2));
  }

  async saveOrder(): Promise<void> {
    if (this.isFinalized) {
      this.showError('Finalized orders are locked and can no longer be edited.');
      return;
    }
    if (!this.orderId) return;
    if (!this.selectedCustomerId) {
      this.showError('Please select a customer.');
      return;
    }
    if (this.cart.length === 0) {
      this.showError('Order must have at least one item.');
      return;
    }
    if (!this.isValidStatusTransition(this.baseStatus, this.status)) {
      this.showError('Invalid status transition. Allowed: pending -> confirmed/cancelled, confirmed -> completed, completed -> refunded.');
      return;
    }
    const shouldUpdateOrderedItems = !this.isOrderedItemsLocked && this.haveOrderedItemsChanged();
    if (shouldUpdateOrderedItems) {
      const invalidStockEntry = this.cart.find(
        (row) => row.item.type === 'product' && row.quantity > this.maxStock(row.item)
      );
      if (invalidStockEntry) {
        this.showError(`Quantity for ${invalidStockEntry.item.name} exceeds available stock (${this.maxStock(invalidStockEntry.item)}).`);
        return;
      }
    }

    this.error = '';
    this.message = '';

    // Send full financial fields; API still recomputes totals server-side for final source of truth.
    const payload: Record<string, unknown> = {
      customerId: this.selectedCustomerId,
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      shippingAmount: Number(this.shippingAmount || 0),
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      withHoldingTaxAmount: this.withHoldingTaxAmount,
      withholdingTaxTypeId: this.applyWithholdingTax && this.withholdingTaxTypeId ? this.withholdingTaxTypeId : null,
      discountAmount: this.discountAmount,
      totalAmount: this.totalAmount,
      notes: this.notes.trim() || undefined,
    };

    // Send orderedItems only when user actually changed line items.
    if (shouldUpdateOrderedItems) {
      payload['orderedItems'] = this.cart.map((row) => ({
        itemId: row.item.id,
        quantity: row.quantity,
      }));
    }

    if (!this.isCompleted && String(this.status).toLowerCase() === 'completed') {
      const defaultDueDate = String(this.order?.dueDate || '').trim() || this.todayIsoDate();
      this.completeOrderForm.reset({
        salesInvoiceId: '',
        salesInvoiceIssueDate: this.todayIsoDate(),
        dueDate: defaultDueDate,
      });
      this.completeFormSubmitted = false;
      this.completionModalError = '';
      this.showCompleteModal = true;
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Order',
      message: 'Save changes to this order?',
      confirmText: 'Update Order',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-pencil-square',
    });
    if (!confirmed) {
      return;
    }

    this.submitOrderUpdate(payload);
  }

  async markAsRefunded(): Promise<void> {
    if (!this.isCompleted) {
      this.showError('Only completed orders can be refunded.');
      return;
    }

    const confirmed = await this.confirmDialog.confirm({
      title: 'Mark Order As Refunded',
      message: 'Set this completed order status to refunded?',
      confirmText: 'Mark Refunded',
      confirmButtonClass: 'ui-btn-danger',
      iconClass: 'bi-arrow-counterclockwise',
    });
    if (!confirmed) {
      return;
    }

    this.submitOrderUpdate({ status: 'refunded' });
  }

  closeCompleteModal(): void {
    if (this.saving) return;
    this.showCompleteModal = false;
    this.completeFormSubmitted = false;
    this.completionModalError = '';
  }

  onCompletionSalesInvoiceIdInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }
    const masked = String(input.value || '').replace(/\D/g, '').slice(0, 4);
    if (input.value !== masked) {
      input.value = masked;
    }
    this.completeOrderForm.patchValue({ salesInvoiceId: masked }, { emitEvent: false });
  }

  onCompletionSalesInvoiceIdBlur(): void {
    const raw = String(this.completeOrderForm.get('salesInvoiceId')?.value || '').replace(/\D/g, '').slice(0, 4);
    if (!raw) {
      this.completeOrderForm.patchValue({ salesInvoiceId: '' }, { emitEvent: false });
      return;
    }
    this.completeOrderForm.patchValue({ salesInvoiceId: raw.padStart(4, '0') }, { emitEvent: false });
  }

  confirmCompletion(): void {
    this.completeFormSubmitted = true;
    this.completeOrderForm.markAllAsTouched();
    if (this.completeOrderForm.invalid) {
      this.completionModalError = 'Please fix the validation errors before completing this order.';
      return;
    }

    const salesInvoiceId = String(this.completeOrderForm.get('salesInvoiceId')?.value || '')
      .replace(/\D/g, '')
      .slice(0, 4)
      .padStart(4, '0');
    const salesInvoiceIssueDate = String(this.completeOrderForm.get('salesInvoiceIssueDate')?.value || '').trim() || this.todayIsoDate();
    const dueDate = String(this.completeOrderForm.get('dueDate')?.value || '').trim() || this.todayIsoDate();
    this.completionModalError = '';

    const payload: Record<string, unknown> = {
      customerId: this.selectedCustomerId,
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      shippingAmount: Number(this.shippingAmount || 0),
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      withHoldingTaxAmount: this.withHoldingTaxAmount,
      withholdingTaxTypeId: this.applyWithholdingTax && this.withholdingTaxTypeId ? this.withholdingTaxTypeId : null,
      discountAmount: this.discountAmount,
      totalAmount: this.totalAmount,
      notes: this.notes.trim() || undefined,
      salesInvoiceId,
      salesInvoiceIssueDate,
      dueDate,
      salesInvoiceDueDate: dueDate,
    };

    this.submitOrderUpdate(payload);
  }

  private submitOrderUpdate(payload: Record<string, unknown>): void {
    this.saving = true;
    this.error = '';
    this.message = '';
    this.completionModalError = '';

    this.api.update<OrderRow>('/api/v1/orders', this.orderId, payload).subscribe({
      next: (response) => {
        this.saving = false;
        this.showCompleteModal = false;
        this.completeOrderForm.reset({
          salesInvoiceId: '',
          salesInvoiceIssueDate: this.todayIsoDate(),
          dueDate: this.todayIsoDate(),
        });
        this.completeFormSubmitted = false;
        this.completionModalError = '';
        this.message = response.message || 'Order updated successfully.';
        this.loadOrder();
      },
      error: (err) => {
        this.saving = false;
        const message = err?.error?.message || 'Unable to update order.';
        if (this.showCompleteModal) {
          this.completionModalError = message;
          return;
        }
        this.showError(message);
      },
    });
  }

  getCompleteControl(name: 'salesInvoiceId' | 'salesInvoiceIssueDate' | 'dueDate'): AbstractControl | null {
    return this.completeOrderForm.get(name);
  }

  isCompleteFieldRequired(name: 'salesInvoiceId' | 'salesInvoiceIssueDate' | 'dueDate'): boolean {
    return Boolean(this.getCompleteControl(name)?.hasValidator(Validators.required));
  }

  shouldShowCompleteFieldError(name: 'salesInvoiceId' | 'salesInvoiceIssueDate' | 'dueDate'): boolean {
    const control = this.getCompleteControl(name);
    return Boolean(control?.invalid && (control.touched || control.dirty || this.completeFormSubmitted));
  }

  getCompleteFieldError(name: 'salesInvoiceId' | 'salesInvoiceIssueDate' | 'dueDate'): string {
    const control = this.getCompleteControl(name);
    if (!control || !this.shouldShowCompleteFieldError(name)) {
      return '';
    }
    if (control.hasError('required')) {
      if (name === 'salesInvoiceId') return 'Sales Invoice ID is required.';
      if (name === 'salesInvoiceIssueDate') return 'Issue Date is required.';
      return 'Due Date is required.';
    }
    if (name === 'salesInvoiceId' && control.hasError('pattern')) {
      return 'Sales Invoice ID must be exactly 4 digits.';
    }
    return 'Invalid value.';
  }

  customerLabel(row: CustomerRow): string {
    return `${row.name} (${row.taxId})`;
  }

  onApplyWithholdingTaxChange(): void {
    if (!this.applyWithholdingTax) {
      this.withholdingTaxTypeId = '';
    }
  }

  exceedsStock(row: CartItem): boolean {
    return row.item.type === 'product' && row.quantity > this.maxStock(row.item);
  }

  printOrder(): void {
    window.print();
  }

  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private derivedVatRateFromOrder(): number {
    const subtotal = Number(this.order?.subtotalAmount || 0);
    const tax = Number(this.order?.taxAmount || 0);
    const taxable = subtotal - tax;
    if (subtotal > 0 && tax > 0 && taxable > 0) {
      return Number(((tax / taxable) * 100).toFixed(2));
    }
    const snapshotRate = Number(this.order?.orderedItemSnapshots?.[0]?.taxRate ?? 0);
    return Number.isFinite(snapshotRate) && snapshotRate > 0 ? Number(snapshotRate.toFixed(2)) : 0;
  }

  private haveOrderedItemsChanged(): boolean {
    const normalizedCart = this.cart
      .map((row) => ({
        itemId: String(row.item.id || '').trim(),
        quantity: Math.max(1, Number(row.quantity || 1)),
      }))
      .filter((row) => row.itemId)
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    const normalizedSnapshots = (this.order?.orderedItemSnapshots || [])
      .map((row) => ({
        itemId: String(row.itemId || '').trim(),
        quantity: Math.max(1, Number(row.quantity || 1)),
      }))
      .filter((row) => row.itemId)
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    if (normalizedCart.length !== normalizedSnapshots.length) {
      return true;
    }

    for (let index = 0; index < normalizedCart.length; index += 1) {
      const cartRow = normalizedCart[index];
      const snapshotRow = normalizedSnapshots[index];
      if (!snapshotRow || cartRow.itemId !== snapshotRow.itemId || cartRow.quantity !== snapshotRow.quantity) {
        return true;
      }
    }

    return false;
  }

  private loadWithholdingTaxTypes(): void {
    if (!this.organizationId) {
      this.withholdingTaxTypes = [];
      return;
    }
    this.loadingWithholdingTaxTypes = true;
    this.api
      .list<WithholdingTaxTypeOption>(
        `/api/v1/withholding-tax-types?organizationId=${encodeURIComponent(this.organizationId)}&activeOnly=true`
      )
      .subscribe({
        next: (response) => {
          this.loadingWithholdingTaxTypes = false;
          this.withholdingTaxTypes = response.data || [];
        },
        error: () => {
          this.loadingWithholdingTaxTypes = false;
          this.withholdingTaxTypes = [];
        },
      });
  }

  activityBadgeClass(actionType: string | undefined): string {
    const normalized = String(actionType || '').toLowerCase();
    if (normalized === 'status_changed' || normalized === 'order_completed') {
      return 'ui-badge-success';
    }
    if (normalized === 'inventory_deducted') {
      return 'ui-badge-warning';
    }
    if (normalized === 'sales_invoice_created') {
      return 'ui-badge-primary';
    }
    return 'ui-badge-secondary';
  }

  activityIcon(actionType: string | undefined): string {
    const normalized = String(actionType || '').toLowerCase();
    if (normalized === 'order_created') return 'bi-plus-circle';
    if (normalized === 'order_updated') return 'bi-pencil-square';
    if (normalized === 'status_changed') return 'bi-arrow-left-right';
    if (normalized === 'inventory_deducted') return 'bi-box-seam';
    if (normalized === 'sales_invoice_created') return 'bi-file-earmark-check';
    return 'bi-clock-history';
  }

  actorLabel(activity: OrderActivityRow): string {
    const actor = activity.actor;
    if (!actor) return 'System';
    const fullName = [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim();
    return fullName || actor.email || 'System';
  }

  showMoreActivities(): void {
    this.activityVisibleCount += 3;
  }

  trackByWithholdingTaxTypeId(index: number, row: WithholdingTaxTypeOption): string {
    return row.id || String(index);
  }

  trackByCustomerId(index: number, row: CustomerRow): string {
    return row.id || String(index);
  }

  trackByActivityId(index: number, row: OrderActivityRow): string {
    return row.id || String(index);
  }

  trackByChangedField(index: number, field: string): string {
    return field || String(index);
  }

  trackByItemId(index: number, row: ItemRow): string {
    return row.id || String(index);
  }

  trackByCartItemId(index: number, row: CartItem): string {
    return row.item.id || String(index);
  }

  trackBySnapshotId(index: number, row: OrderSnapshotRow): string {
    return row.id || row.itemId || String(index);
  }

  private showError(message: string): void {
    this.error = message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
