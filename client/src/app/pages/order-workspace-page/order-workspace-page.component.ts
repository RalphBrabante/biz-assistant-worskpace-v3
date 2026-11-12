import { SalesInvoiceSheetComponent, PrintableInvoice } from '../../shared/sales-invoice-sheet/sales-invoice-sheet.component';
import {MoneyInputDirective} from '../../shared/money-input.directive';
import {RowActionsComponent} from '../../shared/row-actions.component';
import { DeliveryReceipt } from '../../shared/delivery-receipt-sheet/delivery-receipt-sheet.component';
import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, ViewChild, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, forkJoin, catchError, of } from 'rxjs';
import { ExpenseTaxType, isVatTaxType } from '../../core/expense-calculation';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ModalDirective } from '../../shared/modal.directive';
import { OrderProofUploadComponent, ProofUploadState } from './proof-upload/order-proof-upload.component';
interface Settings { preset: string; customerRequired: boolean; inventoryEnabled: boolean; shippingEnabled: boolean; approvalThreshold: number | null; paymentTermsDays: number; }
interface CatalogItem { id: string; name: string; sku?: string; type: string; unit: string; price: number; discountedPrice?: number; stock: number; }
interface Customer { legalName?: string; taxId?: string; addressLine1?: string; addressLine2?: string; city?: string; state?: string; postalCode?: string; country?: string; id: string; name: string; requiresPurchaseOrder: boolean; paymentTermsDays?: number; }
interface Line { id?: string; itemId: string | null; name: string; type: string; unit: string; quantity: number; unitPrice: number; discountedUnitPrice?: number | null; lineTotal?: number; lineTax?: number; taxRate?: number; }
interface Invoice { id: string; invoiceNumber: string; status: string; paymentStatus: string; totalAmount: number; dueDate?: string; }
interface Payment { source?: string; id: string; kind: string; amount: number; reference: string; date: string; invoiceId: string; }
interface Document { id: string; name: string; size: number; createdAt: string; }
interface Activity { id: string; title: string; description: string; createdAt: string; actor?: { firstName: string; lastName: string }; }
interface Workflow { settings: Settings; approval: string; poRequired: boolean; po: { status?: string; date?: string; amount?: number | null; documentId?: string; verifiedAt?: string; verificationNote?: string }; paymentTermsDays: number; fulfilled: Record<string, number>; payments: Payment[]; }
interface Order { id: string; organizationId: string; orderNumber: string; revision: number; status: string; paymentStatus: string; fulfillmentStatus: string; invoicingStatus: string; customerId: string | null; customer?: Customer; customerPoNumber?: string; promisedDate?: string; dueDate?: string; billingAddress?: string; shippingAddress?: string; notes?: string; currency: string; shippingAmount: number; withholdingTaxTypeId?: string; withholdingTaxType?: { name: string; percentage: number }; totalAmount: number; taxAmount: number; withHoldingTaxAmount: number; workflow: Workflow | null; orderedItemSnapshots: Line[]; salesInvoices: Invoice[]; deliveryReceipts?: DeliveryReceipt[]; documents: Document[]; activities: Activity[]; balances: { invoiced: number; paid: number; toInvoice: number; outstanding: number; orderBalance: number }; }
@Component({ selector: 'app-order-workspace-page', standalone: true, imports: [SalesInvoiceSheetComponent, MoneyInputDirective, RowActionsComponent, CommonModule, FormsModule, RouterLink, ModalDirective, OrderProofUploadComponent], templateUrl: './order-workspace-page.component.html', styleUrl: './order-workspace-page.component.scss' })
export class OrderWorkspacePageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly context = inject(OrganizationContextService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly subscriptions = new Subscription();
  order: Order | null = null;
  proofUploads: ProofUploadState[] = [];
  @ViewChild(OrderProofUploadComponent) proofUploader?: OrderProofUploadComponent;
  loading = false; busy = false; error = ''; success = ''; dirty = false;
  tab = 'items'; readonly tabs = ['items', 'purchase order', 'fulfillment', 'invoices', 'payments', 'activity'];
  config: Settings = { preset: 'distribution', customerRequired: false, inventoryEnabled: true, shippingEnabled: true, approvalThreshold: null, paymentTermsDays: 30 };
  settingsDraft: Settings = { ...this.config };
  presets: Record<string, Settings> = {};
  settingsOpen = false;
  currency = 'USD';
  customers: Customer[] = []; catalog: CatalogItem[] = []; taxes: { id: string; name: string; percentage: number; appliesTo: string }[] = [];
  customerQuery = ''; catalogQuery = ''; catalogChoice = '';
  lines: Line[] = [];
  customerId = ''; customerPoNumber = ''; customerPoDate = ''; customerPoAmount: number | null = null; poRequired = false;
  promisedDate = ''; dueDate = ''; paymentTermsDays = 30; shippingAmount = 0; withholdingTaxTypeId = ''; billingAddress = ''; shippingAddress = ''; notes = '';
  fulfillment: Record<string, number> = {};
  actionModal = ''; actionNote = ''; actionAmount = 0; actionInvoiceId = ''; actionInvoiceNumber = ''; actionDate = new Date().toISOString().slice(0, 10); actionDueDate = ''; inventoryDecision = '';
  invoicePreview: PrintableInvoice | null = null;
  invoiceDetails = { soldTo: '', address: '', taxId: '', businessStyle: '', terms: '', oscaPwdId: '' };
  receiptNumber = ''; receiptQuantities: Record<string, number> = {}; recordFulfillment = false; actionReceiptId = '';
  receiptDetails = { deliveredTo: '', address: '', taxId: '', businessStyle: '', terms: '', poNumber: '', deliveredBy: '', preparedBy: '' };
  private requestKey = crypto.randomUUID();
  private org = '';
  private routeId = '';
  private lookupGeneration = 0;
  private loadGeneration = 0;
  lookupErrors: string[] = [];
  lookupsLoading = false;
  organizationTaxType: ExpenseTaxType | null = null;
  constructor() {
    effect(() => {
      this.context.selectedOrganizationId();
      const id = this.context.getActiveOrganizationId();
      if (!this.route.snapshot.paramMap.get('id') && id !== this.org) {
        this.org = id;
        this.reset();
        if (id) this.loadLookups();
      }
    });
  }
  ngOnInit(): void {
    this.subscriptions.add(this.route.paramMap.subscribe(params => {
      if ((params.get('id') || '') !== this.routeId) this.proofUploads = [];
      this.routeId = params.get('id') || '';
      if (this.routeId) this.load();
      else { this.org = this.context.getActiveOrganizationId(); this.reset(); if (this.org) this.loadLookups(); }
    }));
  }
  @HostListener('document:keydown.escape') closeModal(): void { if (!this.busy) { this.actionModal = ''; this.settingsOpen = false; } }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.lookupGeneration++; this.loadGeneration++; }
  get hasUnsavedChanges(): boolean { return this.dirty || this.proofUploads.length > 0; }
  get uploadsIncomplete(): boolean { return this.proofUploads.some(upload => upload.status !== 'uploaded'); }
  get orderOrganizationId(): string { return this.org; }
  get hasOrganization(): boolean { return !!this.org; }
  get editable(): boolean { return !this.order || !!this.order.workflow && ['draft', 'pending'].includes(this.order.status); }
  get canEdit(): boolean { return this.editable && this.can(this.order ? 'orders.update' : 'orders.create'); }
  get active(): boolean { return !!this.order?.workflow && ['confirmed', 'processing', 'completed'].includes(this.order.status); }
  get customerRequiresPo(): boolean { return !!(this.customers.find(c => c.id === this.customerId)?.requiresPurchaseOrder || this.order?.customer?.id === this.customerId && this.order.customer.requiresPurchaseOrder); }
  private round(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
  get estimatedSubtotal(): number { return this.round(this.lines.reduce((sum, line) => sum + this.round(Number(line.quantity || 0) * Number(line.unitPrice || 0)), 0)); }
  get estimatedTax(): number {
    return this.round(this.lines.reduce((sum, line) => {
      const rate = this.organizationTaxType ? (isVatTaxType(this.organizationTaxType) ? Number(this.organizationTaxType.percentage || 0) : 0) : Number(line.taxRate || 0);
      const total = this.round(Number(line.quantity || 0) * Number(line.unitPrice || 0));
      return sum + (rate ? this.round(total - total / (1 + rate / 100)) : 0);
    }, 0));
  }
  get estimatedWithholding(): number | null {
    if (this.selectedTaxUnavailable) return null;
    return this.round((this.estimatedSubtotal - this.estimatedTax) * Number(this.taxes.find(tax => tax.id === this.withholdingTaxTypeId)?.percentage || 0) / 100);
  }
  get estimate(): number | null { const withholding = this.estimatedWithholding; return withholding === null ? null : this.round(this.estimatedSubtotal + Number(this.shippingAmount || 0) - withholding); }
  get lineAmounts(): { gross: number; tax: number; withholding: number | null; due: number | null }[] {
    const saved = !!this.order && !this.dirty;
    const amounts = this.lines.map(line => {
      const gross = saved && line.lineTotal != null ? Number(line.lineTotal) : this.round(Number(line.quantity || 0) * Number(line.unitPrice || 0));
      const rate = this.organizationTaxType ? (isVatTaxType(this.organizationTaxType) ? Number(this.organizationTaxType.percentage || 0) : 0) : Number(line.taxRate || 0);
      const tax = saved && line.lineTax != null ? Number(line.lineTax) : rate ? this.round(gross - gross / (1 + rate / 100)) : 0;
      return { gross, tax, base: Math.max(0, this.round(gross - tax)) };
    });
    const base = this.round(amounts.reduce((sum, line) => sum + line.base, 0));
    const withholding = saved ? Number(this.order!.withHoldingTaxAmount || 0) : this.estimatedWithholding;
    let cumulative = 0, allocated = 0;
    return amounts.map(line => {
      if (withholding === null) return { ...line, withholding: null, due: null };
      cumulative = this.round(cumulative + line.base);
      const target = base > 0 ? this.round(withholding * cumulative / base) : 0;
      const share = this.round(target - allocated); allocated = target;
      return { ...line, withholding: share, due: this.round(line.gross - share) };
    });
  }
  amountOrUnavailable(value: number | null): string { return value === null ? 'Unavailable' : this.money(value); }
  get selectedTaxUnavailable(): boolean { return !!this.withholdingTaxTypeId && !this.taxes.some(tax => tax.id === this.withholdingTaxTypeId); }
  get canFulfill(): boolean { return !!this.order?.workflow && ['confirmed', 'processing'].includes(this.order.status) && this.can('orders.update'); }
  get fulfillmentSelection(): { id: string; name: string; quantity: number; unit: string }[] {
    return this.lines.filter(line => line.id && Number(this.fulfillment[line.id]) > 0).map(line => ({ id: line.id!, name: line.name, quantity: Number(this.fulfillment[line.id!]), unit: line.unit }));
  }
  get fulfillmentError(): string {
    if (!this.canFulfill) return 'Confirm the order before recording fulfillment.';
    for (const line of this.lines) {
      const amount = Number(this.fulfillment[line.id!] ?? 0);
      if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.00001) return `Enter a nonnegative quantity with up to 3 decimal places for ${line.name}.`;
      if (amount > this.remaining(line)) return `Only ${this.remaining(line)} ${line.unit} remain for ${line.name}.`;
    }
    return this.fulfillmentSelection.length ? '' : 'Enter a quantity under Fulfill now, or select Fill remaining quantities.';
  }
  fillRemaining(): void { if (!this.canFulfill || this.busy || this.hasUnsavedChanges) return; this.fulfillment = Object.fromEntries(this.lines.filter(line => line.id).map(line => [line.id!, this.remaining(line)])); this.error = ''; }

  // The order total is net of withholding tax, but customers usually raise the PO
  // for the full amount and deduct EWT when paying. Either amount matches the PO.
  get poNetTotal(): number | null { return this.dirty || !this.order ? this.estimate : Number(this.order.totalAmount); }
  get poWithholding(): number | null { return this.dirty || !this.order ? this.estimatedWithholding : Number(this.order.withHoldingTaxAmount || 0); }
  get poGrossTotal(): number | null { const net = this.poNetTotal, withholding = this.poWithholding; return net === null || withholding === null ? null : this.round(net + withholding); }
  get poMatchesGross(): boolean { return this.customerPoAmount !== null && !!this.poWithholding && this.round(Number(this.customerPoAmount)) === this.poGrossTotal; }
  get poMismatch(): boolean {
    if (this.customerPoAmount === null || this.poNetTotal === null) return false;
    const po = this.round(Number(this.customerPoAmount));
    return po !== this.poNetTotal && po !== this.poGrossTotal;
  }
  can(permission: string): boolean { return this.auth.hasPermission(permission); }
  actionLabel(value: string): string { return ({ submit: 'Submit for approval', approve: 'Approve order', reject: 'Return to draft', confirm: 'Confirm order', cancel: 'Cancel order', complete: 'Complete order', verify_po: 'Verify customer PO', fulfill: 'Record fulfillment', invoice: 'Issue invoice', void_invoice: 'Void invoice', delivery_receipt: 'Issue delivery receipt', void_delivery_receipt: 'Void delivery receipt', payment: 'Record payment', refund: 'Record refund', reconcile: 'Enable reviewed workflow' } as Record<string, string>)[value] || value; }
  label(value: string | undefined): string { return (value || '').replace(/_/g, ' '); }
  money(value: unknown): string { return new Intl.NumberFormat('en', { style: 'currency', currency: this.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  changed(): void { this.dirty = true; this.success = ''; }
  reset(): void {
    this.proofUploads = []; this.taxes = []; this.lookupErrors = []; this.organizationTaxType = null; this.loadGeneration++;
    this.order = null; this.lines = []; this.customers = []; this.catalog = []; this.customerId = ''; this.customerPoNumber = ''; this.customerPoDate = ''; this.customerPoAmount = null; this.poRequired = false; this.promisedDate = ''; this.dueDate = ''; this.shippingAmount = 0; this.billingAddress = ''; this.shippingAddress = ''; this.notes = ''; this.withholdingTaxTypeId = ''; this.dirty = false; this.error = ''; this.success = ''; this.tab = 'items'; this.requestKey = crypto.randomUUID(); this.lookupGeneration++;
  }
  load(): void {
    const generation = ++this.loadGeneration;
    this.loading = true; this.error = ''; this.lookupGeneration++;
    this.subscriptions.add(this.api.getFresh<Order>(`/api/v1/orders/${this.routeId}`).subscribe({ next: response => {
      if (generation !== this.loadGeneration) return;
      try {
        if (!response.data) throw new Error('The order could not be loaded. Please reload.');
        this.accept(response.data); this.loading = false; this.loadLookups(); this.applyLinkedAction();
      } catch (error) { this.loading = false; this.error = error instanceof Error ? error.message : 'Unable to read this order. Please reload.'; }
    }, error: e => { if (generation === this.loadGeneration) { this.loading = false; this.fail(e); } } }));
  }
  loadLookups(): void {
    const generation = ++this.lookupGeneration; const scope = `organizationId=${encodeURIComponent(this.org)}`;
    this.lookupErrors = []; this.lookupsLoading = true;
    const recover = (label: string) => { if (generation === this.lookupGeneration) this.lookupErrors.push(`Unable to load ${label}. Retry the order options.`); return of({ data: undefined }); };
    this.subscriptions.add(forkJoin({
      settings: this.api.get<{ settings: Settings; presets: Record<string, Settings>; currency: string; taxType: ExpenseTaxType }>(`/api/v1/orders/workflow-settings?${scope}`).pipe(catchError(() => recover('workflow settings'))),
      customers: this.api.list<Customer>(`/api/v1/customers?${scope}&limit=100&isActive=true`).pipe(catchError(() => recover('customers'))),
      items: this.api.list<CatalogItem>(`/api/v1/items?${scope}&limit=100&isActive=true`).pipe(catchError(() => recover('catalog items'))),
      taxes: this.api.list<{ id: string; name: string; percentage: number; appliesTo: string }>(`/api/v1/withholding-tax-types?${scope}&activeOnly=true`).pipe(catchError(() => recover('withholding tax options')))
    }).subscribe({ next: responses => {
      if (generation !== this.lookupGeneration) return;
      this.lookupsLoading = false;
      if (responses.settings.data) {
        this.presets = responses.settings.data.presets || {}; this.settingsDraft = { ...responses.settings.data.settings };
        this.organizationTaxType = responses.settings.data.taxType || null;
        if (!this.order) { this.config = { ...this.settingsDraft }; this.currency = responses.settings.data.currency || 'USD'; this.paymentTermsDays = this.config.paymentTermsDays; }
      }
      if (responses.customers.data) this.customers = responses.customers.data;
      if (responses.items.data) this.catalog = responses.items.data;
      if (responses.taxes.data) this.taxes = responses.taxes.data;
      if (this.order?.customer && !this.customers.some(c => c.id === this.order!.customer!.id)) this.customers.unshift(this.order.customer);
    } }));
  }
  search(kind: 'customer' | 'item'): void {
    const generation = this.lookupGeneration;
    const endpoint = kind === 'customer' ? 'customers' : 'items'; const q = kind === 'customer' ? this.customerQuery : this.catalogQuery;
    this.subscriptions.add(this.api.list<Customer & CatalogItem>(`/api/v1/${endpoint}?organizationId=${this.org}&limit=100&isActive=true&q=${encodeURIComponent(q)}`).subscribe({ next: r => {
      if (generation !== this.lookupGeneration) return;
      if (kind === 'customer') { const current = this.customers.find(c => c.id === this.customerId); this.customers = r.data || []; if (current && !this.customers.some(c => c.id === current.id)) this.customers.unshift(current); }
      else this.catalog = r.data || [];
    }, error: e => this.fail(e) }));
  }
  chooseCustomer(): void { const customer = this.customers.find(c => c.id === this.customerId); this.poRequired = !!customer?.requiresPurchaseOrder; this.paymentTermsDays = customer?.paymentTermsDays ?? this.config.paymentTermsDays; this.changed(); }
  addCatalog(): void { const item = this.catalog.find(i => i.id === this.catalogChoice); if (!item) return; this.lines.push({ itemId: item.id, name: item.name, type: item.type, unit: item.unit, quantity: 1, unitPrice: Number(item.discountedPrice ?? item.price) }); this.catalogChoice = ''; this.changed(); }
  addCustom(): void { this.lines.push({ itemId: null, name: '', type: 'service', unit: 'each', quantity: 1, unitPrice: 0 }); this.changed(); }
  removeLine(index: number): void { this.lines.splice(index, 1); this.changed(); }
  save(confirmAfter = false): void {
    if (this.busy || !this.org || !this.canEdit) return;
    if (this.uploadsIncomplete) { this.error = 'Wait for uploads to finish, or retry/remove failed files before saving.'; return; }
    if (!this.lines.length || this.lines.some(l => !l.name.trim() || Number(l.quantity) <= 0 || Number(l.unitPrice) < 0)) { this.error = 'Add valid order lines with a description, positive quantity, and nonnegative price.'; return; }
    this.busy = true; this.error = '';
    const body = { uploadIds: this.proofUploads.map(upload => upload.id), organizationId: this.org, requestKey: this.requestKey, revision: this.order?.revision, customerId: this.customerId || null,
      orderedItems: this.lines, customerPoNumber: this.customerPoNumber, customerPoDate: this.customerPoDate, customerPoAmount: this.customerPoAmount,
      poRequired: this.poRequired || this.customerRequiresPo, promisedDate: this.promisedDate, dueDate: this.dueDate, paymentTermsDays: this.paymentTermsDays,
      shippingAmount: this.shippingAmount, billingAddress: this.billingAddress, shippingAddress: this.shippingAddress, notes: this.notes, withholdingTaxTypeId: this.withholdingTaxTypeId || null };
    const hasAttachments = this.proofUploads.length > 0;
    const request = this.order ? this.api.put<Order>(`/api/v1/orders/${this.order.id}`, body) : this.api.create<Order>('/api/v1/orders', body);
    this.subscriptions.add(request.subscribe({ next: response => {
      this.busy = false; if (!response.data) return; const isNew = !this.order; this.proofUploader?.markSaved(); this.accept(response.data); this.proofUploads = []; this.success = hasAttachments ? 'Draft saved with proof of order.' : 'Draft saved.';
      if (isNew) this.router.navigate(['/orders', response.data.id], { replaceUrl: true });
      if (confirmAfter) this.runAction('confirm');
    }, error: e => this.fail(e) }));
  }
  accept(order: Order): void {
    // Be tolerant of older API deployments returning MariaDB JSON as text.
    let workflow = order.workflow;
    if (typeof workflow === 'string') {
      try { workflow = JSON.parse(workflow); } catch { throw new Error('The saved order workflow could not be read. Please reload after updating the API.'); }
    }
    if (workflow && (typeof workflow !== 'object' || Array.isArray(workflow))) throw new Error('The saved order workflow is invalid.');
    if (!order.organizationId || !Array.isArray(order.orderedItemSnapshots)) throw new Error('The order response is incomplete. Please reload.');
    order = { ...order, workflow };
    if (this.org !== order.organizationId) { this.taxes = []; this.organizationTaxType = null; }
    this.org = order.organizationId;
    if (order.customer && !this.customers.some(c => c.id === order.customer!.id)) this.customers.unshift(order.customer);
    this.order = order; this.currency = order.currency; this.config = order.workflow?.settings || this.config;
    this.lines = order.orderedItemSnapshots.map(l => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.discountedUnitPrice ?? l.unitPrice) }));
    this.customerId = order.customerId || ''; this.customerPoNumber = order.customerPoNumber || ''; this.customerPoDate = order.workflow?.po?.date || ''; this.customerPoAmount = order.workflow?.po?.amount ?? null; this.poRequired = order.workflow?.poRequired || false;
    this.promisedDate = order.promisedDate || ''; this.dueDate = order.dueDate || ''; this.paymentTermsDays = order.workflow?.paymentTermsDays ?? this.config.paymentTermsDays;
    this.shippingAmount = Number(order.shippingAmount); this.withholdingTaxTypeId = order.withholdingTaxTypeId || ''; this.billingAddress = order.billingAddress || ''; this.shippingAddress = order.shippingAddress || ''; this.notes = order.notes || ''; this.dirty = false;
    this.fulfillment = Object.fromEntries(this.lines.map(l => [l.id!, 0]));
  }
  // Amount still owed on one invoice after payments and refunds recorded in this order.
  invoiceBalance(invoice: Invoice): number {
    const received = (this.order?.workflow?.payments || []).filter(p => p.invoiceId === invoice.id).reduce((sum, p) => sum + (p.kind === 'refund' ? -Number(p.amount) : Number(p.amount)), 0);
    return Math.max(0, this.round(Number(invoice.totalAmount) - received));
  }
  get canRecordPayment(): boolean { return this.active && this.can('sales_invoices.update'); }
  canPayInvoice(invoice: Invoice): boolean { return this.canRecordPayment && invoice.status !== 'void' && this.invoiceBalance(invoice) > 0; }
  openPayment(invoiceId = ''): void {
    this.openAction('payment');
    if (this.actionModal !== 'payment') return;
    const invoice = this.order?.salesInvoices.find(i => i.id === invoiceId && i.status !== 'void');
    if (invoice) this.selectPaymentInvoice(invoice.id);
  }
  selectPaymentInvoice(invoiceId: string): void {
    this.actionInvoiceId = invoiceId;
    const invoice = this.order?.salesInvoices.find(i => i.id === invoiceId);
    if (this.actionModal === 'payment' && invoice) this.actionAmount = this.invoiceBalance(invoice);
  }
  // Payments are the order's record of money received, so a paid invoice is refunded rather than voided.
  invoiceHasPayments(invoice: Invoice): boolean { return (this.order?.workflow?.payments || []).some(p => p.invoiceId === invoice.id); }
  canVoidInvoice(invoice: Invoice): boolean { return !!this.order?.workflow && invoice.status !== 'void' && this.can('sales_invoices.update') && !this.invoiceHasPayments(invoice); }
  get canIssueInvoice(): boolean { return this.active && this.can('sales_invoices.create'); }
  openVoid(invoiceId: string): void {
    this.openAction('void_invoice');
    if (this.actionModal === 'void_invoice') this.actionInvoiceId = invoiceId;
  }
  // A voided invoice leaves part of the order uninvoiced; go straight to issuing its replacement.
  private afterVoid(voided?: Invoice): void {
    this.tab = 'invoices';
    const remaining = Number(this.order?.balances?.toInvoice || 0);
    const label = voided ? `Invoice ${voided.invoiceNumber} voided.` : 'Invoice voided.';
    if (this.canIssueInvoice && remaining > 0) { this.openAction('invoice'); this.success = `${label} Issue a replacement invoice for the remaining ${this.money(remaining)}.`; }
    else this.success = remaining > 0 ? `${label} ${this.money(remaining)} of this order now needs a replacement invoice.` : label;
  }
  private afterReceipt(action: string, previousIds: Set<string>): void {
    this.tab = 'fulfillment';
    if (action === 'void_delivery_receipt') { this.success = 'Delivery receipt voided. Recorded fulfillment is unchanged.'; return; }
    const issued = this.deliveryReceipts.find(receipt => !previousIds.has(receipt.id));
    this.success = issued ? `Delivery receipt ${issued.receiptNumber} issued.` : 'Delivery receipt issued.';
    if (issued) this.router.navigate(['/orders', this.order!.id, 'delivery-receipts', issued.id]);
  }
  private applyLinkedAction(): void {
    const query = this.route.snapshot.queryParamMap;
    const tab = query?.get('tab'); const voidId = query?.get('voidInvoice');
    if (tab && this.tabs.includes(tab)) this.tab = tab;
    if (voidId) {
      this.tab = 'invoices';
      const invoice = this.order?.salesInvoices.find(i => i.id === voidId);
      if (invoice && this.canVoidInvoice(invoice)) this.openVoid(voidId);
      else if (invoice?.status === 'void') this.success = `Invoice ${invoice.invoiceNumber} is already void.`;
      else if (invoice && this.invoiceHasPayments(invoice)) this.error = `Invoice ${invoice.invoiceNumber} has recorded payments and cannot be voided. Record a refund instead.`;
      return;
    }
    const invoiceId = query?.get('payInvoice');
    if (!invoiceId) return;
    this.tab = 'payments';
    const invoice = this.order?.salesInvoices.find(i => i.id === invoiceId);
    if (invoice && this.canPayInvoice(invoice)) this.openPayment(invoiceId);
    else if (invoice && invoice.status !== 'void' && this.invoiceBalance(invoice) <= 0) this.success = `Invoice ${invoice.invoiceNumber} is already paid.`;
    else if (invoice && !this.active) this.error = 'Confirm this order before recording payments.';
  }
  // Delivery receipts are optional printed documents; quantities are capped by what is not yet on an active receipt.
  get deliveryReceipts(): DeliveryReceipt[] { return this.order?.deliveryReceipts || []; }
  get canIssueReceipt(): boolean { return !!this.order?.workflow && ['confirmed', 'processing', 'completed'].includes(this.order.status) && this.can('orders.update'); }
  canVoidReceipt(receipt: DeliveryReceipt): boolean { return !!this.order?.workflow && receipt.status !== 'void' && this.can('orders.update'); }
  onReceipts(line: Line): number {
    return this.round3(this.deliveryReceipts.filter(r => r.status !== 'void').reduce((sum, r) => sum + (r.receiptDocument?.items || []).filter(i => i.lineId === line.id).reduce((s, i) => s + Number(i.quantity), 0), 0));
  }
  receiptRemaining(line: Line): number { return Math.max(0, this.round3(Number(line.quantity) - this.onReceipts(line))); }
  get receiptAvailable(): boolean { return this.lines.some(line => line.id && this.receiptRemaining(line) > 0); }
  get receiptSelection(): { id: string; quantity: number }[] {
    return this.lines.filter(line => line.id && Number(this.receiptQuantities[line.id]) > 0).map(line => ({ id: line.id!, quantity: Number(this.receiptQuantities[line.id!]) }));
  }
  get receiptError(): string {
    for (const line of this.lines) {
      const amount = Number(this.receiptQuantities[line.id!] ?? 0);
      if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.00001) return `Enter a nonnegative quantity with up to 3 decimal places for ${line.name}.`;
      if (amount > this.receiptRemaining(line)) return `Only ${this.receiptRemaining(line)} ${line.unit} of ${line.name} are not yet on a delivery receipt.`;
      if (this.recordFulfillment && amount > this.remaining(line)) return `Only ${this.remaining(line)} ${line.unit} of ${line.name} remain to be delivered. Clear "Also record as delivered" if this delivery was already recorded.`;
    }
    return this.receiptSelection.length ? '' : 'Enter the quantities on this delivery receipt.';
  }
  openReceipt(): void {
    this.openAction('delivery_receipt');
    if (this.actionModal !== 'delivery_receipt') return;
    // Start from quantities typed in "Fulfill now", otherwise everything not yet on a receipt.
    const typed = this.fulfillmentSelection;
    this.receiptQuantities = Object.fromEntries(this.lines.filter(line => line.id).map(line => {
      const entered = typed.find(entry => entry.id === line.id)?.quantity;
      return [line.id!, typed.length ? Math.min(entered || 0, this.receiptRemaining(line)) : this.receiptRemaining(line)];
    }));
    this.recordFulfillment = this.canFulfill && this.receiptSelection.every(entry => entry.quantity <= this.remaining(this.lines.find(line => line.id === entry.id)!));
  }
  openVoidReceipt(receiptId: string): void {
    this.openAction('void_delivery_receipt');
    if (this.actionModal === 'void_delivery_receipt') this.actionReceiptId = receiptId;
  }
  private round3(value: number): number { return Math.round((value + Number.EPSILON) * 1000) / 1000; }
  openAction(action: string): void {
    if (this.hasUnsavedChanges) { this.error = 'Save the draft and selected attachment before taking this action.'; return; }
    if (action === 'fulfill' && this.fulfillmentError) { this.error = this.fulfillmentError; return; }
    this.invoicePreview = null;
    const customer = this.order?.customer;
    this.invoiceDetails = { soldTo: customer?.legalName || customer?.name || '', address: this.order?.billingAddress || [customer?.addressLine1, customer?.addressLine2, customer?.city, customer?.state, customer?.postalCode, customer?.country].filter(Boolean).join(', '), taxId: customer?.taxId || '', businessStyle: customer?.legalName || customer?.name || '', terms: this.paymentTermsDays === 0 ? 'Cash' : `${this.paymentTermsDays} days`, oscaPwdId: '' };
    const address = this.order?.shippingAddress || this.order?.billingAddress || [customer?.addressLine1, customer?.addressLine2, customer?.city, customer?.state, customer?.postalCode, customer?.country].filter(Boolean).join(', ');
    this.receiptDetails = { deliveredTo: customer?.legalName || customer?.name || '', address, taxId: customer?.taxId || '', businessStyle: customer?.legalName || customer?.name || '', terms: this.invoiceDetails.terms, poNumber: this.order?.customerPoNumber || '', deliveredBy: '', preparedBy: '' };
    this.receiptNumber = ''; this.receiptQuantities = {}; this.recordFulfillment = false; this.actionReceiptId = this.deliveryReceipts.find(r => r.status !== 'void')?.id || '';
    this.actionModal = action; this.actionNote = ''; this.actionInvoiceNumber = ''; this.actionDueDate = ''; this.inventoryDecision = '';
    const invoices = (this.order?.salesInvoices || []).filter(i => i.status !== 'void');
    const unpaid = action === 'payment' ? invoices.find(i => this.invoiceBalance(i) > 0) : undefined;
    this.actionInvoiceId = (unpaid || invoices[0])?.id || '';
    this.actionAmount = action === 'invoice' ? this.order?.balances.toInvoice || 0 : unpaid ? this.invoiceBalance(unpaid) : 0;
    const now = new Date(); this.actionDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; this.error = '';
  }
  reviewInvoice(): void {
    if (!this.order || this.busy || this.hasUnsavedChanges) return;
    this.busy = true; this.error = '';
    this.subscriptions.add(this.api.create<PrintableInvoice>(`/api/v1/orders/${this.order.id}/invoice-preview`, {
      revision: this.order.revision, amount: this.actionAmount, invoiceNumber: this.actionInvoiceNumber,
      issueDate: this.actionDate, dueDate: this.actionDueDate, note: this.actionNote, invoiceDetails: this.invoiceDetails,
    }).subscribe({ next: response => {
      this.busy = false; this.invoicePreview = response.data || null;
      if (this.invoicePreview) { this.actionInvoiceNumber = this.invoicePreview.invoiceNumber; this.actionDueDate = this.invoicePreview.dueDate || ''; }
    }, error: e => this.fail(e) }));
  }
  runAction(action: string): void {
    if (!this.order || this.busy || this.hasUnsavedChanges) return;
    if (action === 'fulfill' && this.fulfillmentError) { this.error = this.fulfillmentError; return; }
    if (action === 'invoice' && !this.invoicePreview) { this.reviewInvoice(); return; }
    if (action === 'delivery_receipt' && this.receiptError) { this.error = this.receiptError; return; }
    this.busy = true; this.error = '';
    const previousInvoiceIds = new Set(this.order.salesInvoices.map(invoice => invoice.id));
    const voidedInvoice = action === 'void_invoice' ? this.order.salesInvoices.find(invoice => invoice.id === this.actionInvoiceId) : undefined;
    const previousReceiptIds = new Set(this.deliveryReceipts.map(receipt => receipt.id));
    const lines = action === 'delivery_receipt' ? this.receiptSelection : this.lines.filter(l => Number(this.fulfillment[l.id!]) > 0).map(l => ({ id: l.id, quantity: Number(this.fulfillment[l.id!]) }));
    this.subscriptions.add(this.api.create<Order>(`/api/v1/orders/${this.order.id}/actions`, { action, revision: this.order.revision, note: this.actionNote,
      amount: this.actionAmount, invoiceId: this.actionInvoiceId, invoiceNumber: this.actionInvoiceNumber, date: this.actionDate, issueDate: this.actionDate, dueDate: this.actionDueDate,
      invoiceDetails: this.invoiceDetails, inventoryDecision: this.inventoryDecision, lines,
      receiptNumber: this.receiptNumber, receiptDetails: this.receiptDetails, recordFulfillment: this.recordFulfillment, receiptId: this.actionReceiptId }).subscribe({ next: response => { this.busy = false; if (response.data) this.accept(response.data); this.actionModal = ''; if (action === 'invoice') { this.tab = 'invoices'; const issued = this.order?.salesInvoices.find(invoice => !previousInvoiceIds.has(invoice.id)); if (issued && this.can('sales_invoices.read')) this.router.navigate(['/sales-invoices', issued.id]); } this.success = action === 'fulfill' ? 'Fulfillment recorded successfully.' : 'Order updated.'; if (action === 'void_invoice') this.afterVoid(voidedInvoice); if (action === 'delivery_receipt' || action === 'void_delivery_receipt') this.afterReceipt(action, previousReceiptIds); }, error: e => this.fail(e) }));
  }
  fileSize(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  download(doc: Document): void {
    this.subscriptions.add(this.api.download(`/api/v1/orders/${this.order!.id}/documents/${doc.id}`).subscribe({ next: blob => { const url = URL.createObjectURL(blob); const link = window.document.createElement('a'); link.href = url; link.download = doc.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, error: e => this.fail(e) }));
  }
  remaining(line: Line): number { return Math.max(0, Number(line.quantity) - Number(this.order?.workflow?.fulfilled[line.id!] || 0)); }
  usePreset(): void { this.settingsDraft = { ...this.presets[this.settingsDraft.preset] }; }
  saveSettings(): void {
    this.busy = true;
    this.subscriptions.add(this.api.put<{ settings: Settings }>('/api/v1/orders/workflow-settings', { organizationId: this.org, settings: this.settingsDraft }).subscribe({ next: r => { this.busy = false; this.settingsOpen = false; if (!this.order && r.data) { this.config = r.data.settings; this.paymentTermsDays = this.config.paymentTermsDays; } this.success = 'Workflow settings saved for new orders.'; }, error: e => this.fail(e) }));
  }
  async reload(): Promise<void> {
    if (this.hasUnsavedChanges && !await this.confirmDialog.confirm({ title: 'Discard draft changes?', message: 'Reload the last saved order and discard your unsaved changes and selected attachment?', confirmText: 'Reload' })) return;
    this.proofUploader?.discardAll();
    this.proofUploads = [];
    this.load();
  }
  print(): void { this.tab = 'items'; setTimeout(() => window.print(), 0); }
  private fail(error: { error?: { message?: string }; status?: number }): void { this.busy = false; this.error = error?.error?.message || 'Unable to process this request.'; }
}
