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
interface Customer { id: string; name: string; requiresPurchaseOrder: boolean; paymentTermsDays?: number; }
interface Line { id?: string; itemId: string | null; name: string; type: string; unit: string; quantity: number; unitPrice: number; discountedUnitPrice?: number | null; lineTotal?: number; taxRate?: number; }
interface Invoice { id: string; invoiceNumber: string; status: string; paymentStatus: string; totalAmount: number; dueDate?: string; }
interface Payment { id: string; kind: string; amount: number; reference: string; date: string; invoiceId: string; }
interface Document { id: string; name: string; size: number; createdAt: string; }
interface Activity { id: string; title: string; description: string; createdAt: string; actor?: { firstName: string; lastName: string }; }
interface Workflow { settings: Settings; approval: string; poRequired: boolean; po: { status?: string; date?: string; amount?: number | null; documentId?: string; verifiedAt?: string; verificationNote?: string }; paymentTermsDays: number; fulfilled: Record<string, number>; payments: Payment[]; }
interface Order { id: string; organizationId: string; orderNumber: string; revision: number; status: string; paymentStatus: string; fulfillmentStatus: string; invoicingStatus: string; customerId: string | null; customer?: Customer; customerPoNumber?: string; promisedDate?: string; dueDate?: string; billingAddress?: string; shippingAddress?: string; notes?: string; currency: string; shippingAmount: number; withholdingTaxTypeId?: string; totalAmount: number; taxAmount: number; withHoldingTaxAmount: number; workflow: Workflow | null; orderedItemSnapshots: Line[]; salesInvoices: Invoice[]; documents: Document[]; activities: Activity[]; balances: { invoiced: number; paid: number; toInvoice: number; outstanding: number; orderBalance: number }; }
@Component({ selector: 'app-order-workspace-page', standalone: true, imports: [CommonModule, FormsModule, RouterLink, ModalDirective, OrderProofUploadComponent], templateUrl: './order-workspace-page.component.html', styleUrl: './order-workspace-page.component.scss' })
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
  get estimatedWithholding(): number { return this.round((this.estimatedSubtotal - this.estimatedTax) * Number(this.taxes.find(tax => tax.id === this.withholdingTaxTypeId)?.percentage || 0) / 100); }
  get estimate(): number { return this.round(this.estimatedSubtotal + Number(this.shippingAmount || 0) - this.estimatedWithholding); }
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

  get poMismatch(): boolean { return this.customerPoAmount !== null && Number(this.customerPoAmount) !== Number(this.order?.totalAmount ?? this.estimate); }
  can(permission: string): boolean { return this.auth.hasPermission(permission); }
  actionLabel(value: string): string { return ({ submit: 'Submit for approval', approve: 'Approve order', reject: 'Return to draft', confirm: 'Confirm order', cancel: 'Cancel order', complete: 'Complete order', verify_po: 'Verify customer PO', fulfill: 'Record fulfillment', invoice: 'Issue invoice', void_invoice: 'Void invoice', payment: 'Record payment', refund: 'Record refund', reconcile: 'Enable reviewed workflow' } as Record<string, string>)[value] || value; }
  label(value: string | undefined): string { return (value || '').replace(/_/g, ' '); }
  money(value: unknown): string { return new Intl.NumberFormat('en', { style: 'currency', currency: this.currency }).format(Number(value || 0)); }
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
        this.accept(response.data); this.loading = false; this.loadLookups();
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
  openAction(action: string): void {
    if (this.hasUnsavedChanges) { this.error = 'Save the draft and selected attachment before taking this action.'; return; }
    if (action === 'fulfill' && this.fulfillmentError) { this.error = this.fulfillmentError; return; }
    this.actionModal = action; this.actionNote = ''; this.actionInvoiceNumber = ''; this.actionDueDate = ''; this.inventoryDecision = '';
    this.actionInvoiceId = this.order?.salesInvoices.find(i => i.status !== 'void')?.id || '';
    this.actionAmount = action === 'invoice' ? this.order?.balances.toInvoice || 0 : 0;
    this.actionDate = new Date().toISOString().slice(0, 10); this.error = '';
  }
  runAction(action: string): void {
    if (!this.order || this.busy || this.hasUnsavedChanges) return;
    if (action === 'fulfill' && this.fulfillmentError) { this.error = this.fulfillmentError; return; }
    this.busy = true; this.error = '';
    const lines = this.lines.filter(l => Number(this.fulfillment[l.id!]) > 0).map(l => ({ id: l.id, quantity: Number(this.fulfillment[l.id!]) }));
    this.subscriptions.add(this.api.create<Order>(`/api/v1/orders/${this.order.id}/actions`, { action, revision: this.order.revision, note: this.actionNote,
      amount: this.actionAmount, invoiceId: this.actionInvoiceId, invoiceNumber: this.actionInvoiceNumber, date: this.actionDate, issueDate: this.actionDate, dueDate: this.actionDueDate,
      inventoryDecision: this.inventoryDecision, lines }).subscribe({ next: response => { this.busy = false; if (response.data) this.accept(response.data); this.actionModal = ''; this.success = action === 'fulfill' ? 'Fulfillment recorded successfully.' : 'Order updated.'; }, error: e => this.fail(e) }));
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
