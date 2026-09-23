import { CountrySelectComponent } from '../../shared/country-select.component';
import { getBrowserCountry } from '../../shared/countries';
import { ModalDirective } from '../../shared/modal.directive';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';
import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, map } from 'rxjs/operators';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
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

interface CartItem {
  item: ItemRow;
  quantity: number;
}

interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  taxId: string;
  legalName?: string;
  customerCode?: string;
  isActive?: boolean;
}

interface OrganizationTaxInfo {
  id: string;
  currency?: string;
  taxTypeId?: string;
  taxType?: {
    id: string;
    code?: string;
    name?: string;
    description?: string;
    percentage?: number;
  };
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
  selector: 'app-create-order-page',
  standalone: true,
  imports: [CountrySelectComponent, ModalDirective, OrganizationRequiredComponent, CommonModule, FormsModule, RouterLink],
  templateUrl: './create-order-page.component.html',
})
export class CreateOrderPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly router = inject(Router);

  orderNumber = this.generateOrderNumber();
  status = 'pending';
  paymentStatus = 'unpaid';
  fulfillmentStatus = 'unfulfilled';
  shippingAmount = 0;
  notes = '';

  searchQuery = '';
  customerSearchQuery = '';
  catalogItems: ItemRow[] = [];
  catalogHasMore = false;
  catalogLoadingMore = false;
  private catalogPage = 1;
  private readonly catalogInitialLimit = 10;
  private readonly catalogLoadMoreLimit = 5;
  cart: CartItem[] = [];
  customerResults: CustomerRow[] = [];
  selectedCustomer: CustomerRow | null = null;
  searchingCustomers = false;
  customerDropdownOpen = false;
  isCustomerCreateModalOpen = false;
  creatingCustomer = false;
  customerCreateError = '';
  newCustomer = this.emptyCustomerForm();
  private readonly customerSearchInput$ = new Subject<string>();
  private customerSearchSub?: Subscription;
  organizationVatRate = 0;
  organizationTaxTypeCode = '';
  organizationTaxTypeName = '';
  organizationCurrency = '';
  applyWithholdingTax = false;
  withholdingTaxTypeId = '';
  withholdingTaxTypes: WithholdingTaxTypeOption[] = [];
  private readonly currencyFormatterCache = new Map<string, Intl.NumberFormat>();

  catalogLoading = false;
  withholdingTaxLoading = false;
  submitting = false;
  error = '';
  message = '';

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId();
  }

  get hasOrganizationContext(): boolean {
    return Boolean(this.currentOrganizationId.trim());
  }

  get currentOrganizationCurrency(): string {
    return String(this.auth.currentUser()?.currency || 'USD').toUpperCase();
  }

  get isSuperuser(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get activeCurrency(): string {
    return String(this.organizationCurrency || this.currentOrganizationCurrency || 'USD').toUpperCase();
  }

  formatMoney(value: unknown, currency?: string): string {
    const amount = Number(value ?? 0);
    const code = String(currency || this.activeCurrency || 'USD').toUpperCase();
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

  get taxableAmount(): number {
    if (this.isPercentageTaxOrganization) {
      return this.subtotalAmount;
    }
    const rate = this.organizationVatRate / 100;
    if (rate <= 0) {
      return this.subtotalAmount;
    }
    return Number((this.subtotalAmount / (1 + rate)).toFixed(2));
  }

  get isPercentageTaxOrganization(): boolean {
    return this.isPercentageTaxType(this.organizationTaxTypeCode, this.organizationTaxTypeName);
  }

  get organizationTaxLabel(): string {
    if (this.isPercentageTaxOrganization) {
      return 'Percentage Tax';
    }
    return this.organizationTaxTypeName || 'VAT';
  }

  get percentageTaxAmount(): number {
    if (!this.isPercentageTaxOrganization || this.organizationVatRate <= 0) {
      return 0;
    }
    return Number((this.subtotalAmount * (this.organizationVatRate / 100)).toFixed(2));
  }

  get displayTaxAmountLabel(): string {
    return this.isPercentageTaxOrganization ? 'VAT / Output Tax' : 'Tax';
  }

  ngOnInit(): void {
    this.loadOrganizationTaxRate();
    this.loadWithholdingTaxTypes();
    this.setupCustomerSearch();
  }

  ngOnDestroy(): void {
    this.customerSearchSub?.unsubscribe();
  }

  private setupCustomerSearch(): void {
    const orgId = this.currentOrganizationId.trim();
    this.customerSearchSub = this.customerSearchInput$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((query) => {
        const q = query.trim();
        if (!q || q.length < 1 || !orgId) {
          return of([]);
        }
        this.searchingCustomers = true;
        const params = new URLSearchParams({
          organizationId: orgId,
          q,
          isActive: 'true',
          limit: '15',
        });
        return this.api.list<CustomerRow>(`/api/v1/customers?${params.toString()}`).pipe(
          map((res) => (res.data || []).filter((r) => r.isActive !== false)),
          catchError(() => of([]))
        );
      })
    ).subscribe((results) => {
      this.searchingCustomers = false;
      this.customerResults = results;
      this.customerDropdownOpen = results.length > 0;
    });
  }

  searchItems(): void {
    if (!this.currentOrganizationId.trim()) {
      this.showError(this.organizationContext.isAllOrganizationsSelected()
        ? 'Select a specific organization first.'
        : 'Logged in user has no organization assigned.');
      this.catalogItems = [];
      this.catalogHasMore = false;
      return;
    }

    this.catalogLoading = true;
    this.error = '';
    this.catalogPage = 1;

    this.fetchCatalogPage(this.catalogPage, this.catalogInitialLimit).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.catalogLoading = false;
        const rows = (response.data || []).filter((item) => item.isActive !== false);
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
    if (!this.catalogHasMore || this.catalogLoadingMore || this.catalogLoading) {
      return;
    }

    this.catalogLoadingMore = true;
    this.error = '';
    // Initial search loads 10 records, and every "show more" appends the next 5 from API paging.
    const nextPage = Math.floor(this.catalogItems.length / this.catalogLoadMoreLimit) + 1;

    this.fetchCatalogPage(nextPage, this.catalogLoadMoreLimit).subscribe({
      next: (response: ApiResponse<ItemRow[]>) => {
        this.catalogLoadingMore = false;
        const incoming = (response.data || []).filter((item) => item.isActive !== false);
        this.catalogItems = [...this.catalogItems, ...incoming];
        const total = Number(response.meta?.total || this.catalogItems.length);
        this.catalogHasMore = this.catalogItems.length < total;
      },
      error: (err) => {
        this.catalogLoadingMore = false;
        this.showError(err?.error?.message || 'Unable to load more items.');
      },
    });
  }

  onCustomerSearchInput(value: string): void {
    this.customerSearchQuery = value;
    if (!value.trim()) {
      this.customerResults = [];
      this.customerDropdownOpen = false;
      return;
    }
    this.customerSearchInput$.next(value);
  }

  selectCustomer(customer: CustomerRow): void {
    this.selectedCustomer = customer;
    this.customerSearchQuery = customer.name;
    this.customerDropdownOpen = false;
    this.customerResults = [];
  }

  clearCustomer(): void {
    this.selectedCustomer = null;
    this.customerSearchQuery = '';
    this.customerResults = [];
    this.customerDropdownOpen = false;
  }

  get selectedCustomerId(): string {
    return this.selectedCustomer?.id || '';
  }

  openCustomerCreateModal(): void {
    this.newCustomer = this.emptyCustomerForm();
    if (this.customerSearchQuery.trim()) {
      this.newCustomer['name'] = this.customerSearchQuery.trim();
    }
    this.customerCreateError = '';
    this.customerDropdownOpen = false;
    this.isCustomerCreateModalOpen = true;
  }

  closeCustomerCreateModal(): void {
    this.isCustomerCreateModalOpen = false;
    this.customerCreateError = '';
  }

  createCustomer(): void {
    const name = String(this.newCustomer['name'] || '').trim();
    if (!name) {
      this.customerCreateError = 'Customer name is required.';
      return;
    }

    this.creatingCustomer = true;
    this.customerCreateError = '';

    const payload: Record<string, unknown> = {
      organizationId: this.currentOrganizationId,
      name,
      legalName: String(this.newCustomer['legalName'] || '').trim() || undefined,
      taxId: String(this.newCustomer['taxId'] || '').trim() || undefined,
      contactPerson: String(this.newCustomer['contactPerson'] || '').trim() || undefined,
      email: String(this.newCustomer['email'] || '').trim() || undefined,
      phone: String(this.newCustomer['phone'] || '').trim() || undefined,
      addressLine1: String(this.newCustomer['addressLine1'] || '').trim() || undefined,
      addressLine2: String(this.newCustomer['addressLine2'] || '').trim() || undefined,
      city: String(this.newCustomer['city'] || '').trim() || undefined,
      state: String(this.newCustomer['state'] || '').trim() || undefined,
      postalCode: String(this.newCustomer['postalCode'] || '').trim() || undefined,
      country: String(this.newCustomer['country'] || '').trim() || undefined,
      status: 'active',
      isActive: true,
    };

    this.api.create<CustomerRow>('/api/v1/customers', payload).subscribe({
      next: (response) => {
        this.creatingCustomer = false;
        const created = response.data;
        if (created) {
          this.selectCustomer(created);
        }
        this.isCustomerCreateModalOpen = false;
      },
      error: (err) => {
        this.creatingCustomer = false;
        this.customerCreateError = err?.error?.message || 'Unable to create customer.';
      },
    });
  }

  private emptyCustomerForm(): Record<string, string> {
    return {
      name: '', legalName: '', taxId: '', contactPerson: '',
      email: '', phone: '', addressLine1: '', addressLine2: '',
      city: '', state: '', postalCode: '', country: getBrowserCountry(),
    };
  }

  addToCart(item: ItemRow): void {
    if (item.type === 'product' && !this.canIncreaseItem(item)) {
      this.message = `Cannot add more of ${item.name}. Reached available stock.`;
      return;
    }

    const existing = this.cart.find((entry) => entry.item.id === item.id);
    if (existing) {
      if (item.type === 'product') {
        const availableStock = this.maxStock(item);
        if (existing.quantity >= availableStock) {
          this.message = `Cannot add more of ${item.name}. Reached available stock (${availableStock}).`;
          return;
        }
      }
      existing.quantity += 1;
      return;
    }

    this.cart.push({ item, quantity: 1 });
  }

  increase(itemId: string): void {
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;
    if (entry.item.type === 'product') {
      const availableStock = this.maxStock(entry.item);
      if (entry.quantity >= availableStock) {
        this.message = `Cannot add more of ${entry.item.name}. Reached available stock (${availableStock}).`;
        return;
      }
    }
    entry.quantity += 1;
  }

  updateQuantity(itemId: string, value: unknown): void {
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

  decrease(itemId: string): void {
    const entry = this.cart.find((row) => row.item.id === itemId);
    if (!entry) return;

    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      this.removeFromCart(itemId);
    }
  }

  async removeFromCart(itemId: string): Promise<void> {
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

  itemUnitPrice(item: ItemRow): number {
    const discounted = Number(item.discountedPrice ?? NaN);
    if (Number.isFinite(discounted) && discounted >= 0) {
      return discounted;
    }
    return Number(item.price ?? 0);
  }

  itemLineTotal(row: CartItem): number {
    const price = this.itemUnitPrice(row.item);
    const subtotal = price * row.quantity;
    return Number(subtotal.toFixed(2));
  }

  get subtotalAmount(): number {
    const subtotal = this.cart.reduce((acc, row) => acc + this.itemUnitPrice(row.item) * row.quantity, 0);
    return Number(subtotal.toFixed(2));
  }

  get taxAmount(): number {
    if (this.isPercentageTaxOrganization || this.organizationVatRate <= 0) {
      return 0;
    }
    const tax = this.taxableAmount * (this.organizationVatRate / 100);
    return Number(tax.toFixed(2));
  }

  get discountAmount(): number {
    const discount = this.cart.reduce((acc, row) => {
      const full = Number(row.item.price ?? 0) * row.quantity;
      const effective = this.itemUnitPrice(row.item) * row.quantity;
      const diff = full - effective;
      return acc + (diff > 0 ? diff : 0);
    }, 0);
    return Number(discount.toFixed(2));
  }

  get totalAmount(): number {
    const total =
      this.subtotalAmount + Number(this.shippingAmount || 0) - this.withHoldingTaxAmount;
    return Number(total.toFixed(2));
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
    // Withholding is derived from the taxable base. For non-VAT percentage tax,
    // this remains the gross receipts amount; no VAT-inclusive extraction applies.
    return Number((this.taxableAmount * (percentage / 100)).toFixed(2));
  }

  placeOrder(): void {
    if (!this.currentOrganizationId.trim()) {
      this.showError(this.organizationContext.isAllOrganizationsSelected()
        ? 'Select a specific organization first.'
        : 'Logged in user has no organization assigned.');
      return;
    }
    if (!this.orderNumber.trim()) {
      this.showError('Order number is required.');
      return;
    }
    if (!this.selectedCustomerId.trim()) {
      this.showError('Please select a customer for this order.');
      return;
    }
    if (this.cart.length === 0) {
      this.showError('Add at least one item to place an order.');
      return;
    }
    const invalidStockEntry = this.cart.find(
      (row) => row.item.type === 'product' && row.quantity > this.maxStock(row.item)
    );
    if (invalidStockEntry) {
      this.showError(`Quantity for ${invalidStockEntry.item.name} exceeds available stock (${this.maxStock(invalidStockEntry.item)}).`);
      return;
    }

    // Backend recomputes totals again; payload values are kept for immediate UX preview consistency.
    const payload = {
      organizationId: this.currentOrganizationId.trim(),
      orderNumber: this.orderNumber.trim(),
      customerId: this.selectedCustomerId.trim(),
      source: 'web',
      status: this.status,
      paymentStatus: this.paymentStatus,
      fulfillmentStatus: this.fulfillmentStatus,
      currency: this.activeCurrency,
      subtotalAmount: this.subtotalAmount,
      taxAmount: this.taxAmount,
      withHoldingTaxAmount: this.withHoldingTaxAmount,
      withholdingTaxTypeId: this.applyWithholdingTax && this.withholdingTaxTypeId ? this.withholdingTaxTypeId : null,
      discountAmount: this.discountAmount,
      shippingAmount: Number(this.shippingAmount || 0),
      totalAmount: this.totalAmount,
      notes: this.notes.trim() || undefined,
      orderedItems: this.cart.map((row) => ({
        itemId: row.item.id,
        quantity: row.quantity,
        metadata: {
          uiPrice: this.itemUnitPrice(row.item),
          stockAtOrder: row.item.stock ?? null,
        },
      })),
    };

    this.submitting = true;
    this.error = '';
    this.message = '';

    this.api.create('/api/v1/orders', payload).subscribe({
      next: () => {
        this.submitting = false;
        void this.router.navigate(['/orders']);
      },
      error: (err) => {
        this.submitting = false;
        this.showError(err?.error?.message || 'Unable to place order.');
      },
    });
  }

  private showError(message: string): void {
    this.error = message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private generateOrderNumber(): string {
    const stamp = Date.now();
    return `ORD-${stamp}`;
  }

  maxStock(item: ItemRow): number {
    return Math.max(0, Number(item.stock ?? 0));
  }

  canIncreaseItem(item: ItemRow): boolean {
    if (item.type !== 'product') {
      return true;
    }
    const entry = this.cart.find((row) => row.item.id === item.id);
    const qty = entry ? entry.quantity : 0;
    return qty < this.maxStock(item);
  }

  customerLabel(row: CustomerRow): string {
    return `${row.name} (${row.taxId})`;
  }

  onApplyWithholdingTaxChange(): void {
    if (!this.applyWithholdingTax) {
      this.withholdingTaxTypeId = '';
    }
  }

  private loadWithholdingTaxTypes(): void {
    const orgId = this.currentOrganizationId.trim();
    if (!orgId) {
      this.withholdingTaxTypes = [];
      this.applyWithholdingTax = false;
      this.withholdingTaxTypeId = '';
      return;
    }

    this.withholdingTaxLoading = true;
    // Pull active types from DB table so finance admins can manage options without code changes.
    const endpoint = `/api/v1/withholding-tax-types?organizationId=${encodeURIComponent(
      orgId
    )}&activeOnly=true`;
    this.api.list<WithholdingTaxTypeOption>(endpoint).subscribe({
      next: (response) => {
        this.withholdingTaxLoading = false;
        this.withholdingTaxTypes = response.data || [];
      },
      error: () => {
        this.withholdingTaxLoading = false;
        this.withholdingTaxTypes = [];
      },
    });
  }

  exceedsStock(row: CartItem): boolean {
    return row.item.type === 'product' && row.quantity > this.maxStock(row.item);
  }

  trackByCustomerId(index: number, row: CustomerRow): string {
    return row.id || String(index);
  }

  trackByWithholdingTaxTypeId(index: number, row: WithholdingTaxTypeOption): string {
    return row.id || String(index);
  }

  trackByItemId(index: number, row: ItemRow): string {
    return row.id || String(index);
  }

  trackByCartItemId(index: number, row: CartItem): string {
    return row.item.id || String(index);
  }

  private fetchCatalogPage(page: number, limit: number) {
    const query = encodeURIComponent(this.searchQuery.trim());
    const orgId = encodeURIComponent(this.currentOrganizationId.trim());
    const endpoint = `/api/v1/items?organizationId=${orgId}&q=${query}&isActive=true&page=${page}&limit=${limit}`;
    return this.api.list<ItemRow>(endpoint);
  }

  private loadOrganizationTaxRate(): void {
    const orgId = this.currentOrganizationId.trim();
    if (!orgId) {
      this.organizationVatRate = 0;
      this.organizationTaxTypeCode = '';
      this.organizationTaxTypeName = '';
      this.organizationCurrency = this.currentOrganizationCurrency;
      return;
    }

    this.api.get<OrganizationTaxInfo>(`/api/v1/organizations/${encodeURIComponent(orgId)}`).subscribe({
      next: (response) => {
        const taxType = response.data?.taxType;
        const taxPercentage = Number(taxType?.percentage ?? 0);
        this.organizationVatRate = Number.isFinite(taxPercentage) && taxPercentage > 0 ? taxPercentage : 0;
        this.organizationTaxTypeCode = String(taxType?.code || '').toUpperCase();
        this.organizationTaxTypeName = String(
          taxType?.name || taxType?.description || taxType?.code || ''
        ).trim();
        this.organizationCurrency = String(response.data?.currency || this.currentOrganizationCurrency || 'USD').toUpperCase();
      },
      error: () => {
        this.organizationVatRate = 0;
        this.organizationTaxTypeCode = '';
        this.organizationTaxTypeName = '';
        this.organizationCurrency = this.currentOrganizationCurrency;
      },
    });
  }

  private isPercentageTaxType(code: string, name = ''): boolean {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const normalizedName = String(name || '').trim().toUpperCase();
    return [
      'PT',
      'PERCENTAGE_TAX',
      'PERCENTAGE',
      'NONVAT',
      'NON_VAT',
    ].includes(normalizedCode)
      || normalizedName.includes('PERCENTAGE TAX')
      || normalizedName.includes('NON-VAT')
      || normalizedName.includes('NON VAT');
  }
}
