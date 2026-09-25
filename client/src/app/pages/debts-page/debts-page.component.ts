import {CommonModule} from '@angular/common';
import {Component, OnDestroy, effect, inject} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subscription} from 'rxjs';
import {ApiService} from '../../core/api.service';
import {AuthService} from '../../core/auth.service';
import {OrganizationContextService} from '../../core/organization-context.service';
import {ModalDirective} from '../../shared/modal.directive';
interface Debt {
  id: string; title: string; creditor: string; originalAmount: string; paidAmount: string; remainingAmount: string;
  currency: string; borrowedOn: string; dueOn: string | null; notes: string; status: 'outstanding' | 'paid';
}
interface Payment {id: string; amount: string; paidOn: string; reference: string; notes: string; author?: {firstName: string; lastName: string};}
interface Summary {currency: string; originalAmount: string; paidAmount: string; remainingAmount: string;}
interface ListData {debts: Debt[]; currency: string; summary: Summary[];}
interface Detail {debt: Debt; payments: Payment[];}
@Component({selector: 'app-debts-page', standalone: true, imports: [CommonModule, FormsModule, ModalDirective], templateUrl: './debts-page.component.html', styleUrl: './debts-page.component.css'})
export class DebtsPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly organizations = inject(OrganizationContextService);
  rows: Debt[] = []; summary: Summary[] = []; currency = 'PHP'; search = ''; status = ''; page = 1; pages = 1; total = 0;
  loading = false; saving = false; error = ''; notice = ''; createError = ''; detailError = '';
  createOpen = false; selected: Debt | null = null; detailLoading = false; payments: Payment[] = []; paymentPage = 1; paymentPages = 1; paymentTotal = 0;
  draft = this.newDebt(); payment = this.newPayment();
  private createKey = crypto.randomUUID(); private paymentKey = crypto.randomUUID();
  private listSub?: Subscription; private detailSub?: Subscription; private writes = new Subscription();
  private searchTimer?: ReturnType<typeof setTimeout>;
  constructor() {
    effect(() => {
      this.organizations.selectedOrganizationId(); this.auth.currentUser();
      this.listSub?.unsubscribe(); this.detailSub?.unsubscribe(); this.writes.unsubscribe(); this.writes = new Subscription(); clearTimeout(this.searchTimer);
      this.rows = []; this.summary = []; this.selected = null; this.payments = []; this.createOpen = false; this.saving = false; this.loading = false;
      this.error = ''; this.notice = ''; this.search = ''; this.status = ''; this.page = 1; this.total = 0; this.pages = 1;
      this.draft = this.newDebt(); this.payment = this.newPayment(); this.createKey = crypto.randomUUID(); this.paymentKey = crypto.randomUUID();
      if (this.organizations.getActiveOrganizationId()) this.load();
    });
  }
  ngOnDestroy(): void {clearTimeout(this.searchTimer); this.listSub?.unsubscribe(); this.detailSub?.unsubscribe(); this.writes.unsubscribe();}
  get canCreate(): boolean {return this.auth.hasPermission('debts.create');}
  get canPay(): boolean {return this.auth.hasPermission('debts.pay');}
  today(): string {const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);}
  newDebt() {return {title: '', creditor: '', amount: '', borrowedOn: this.today(), dueOn: '', notes: ''};}
  newPayment() {return {amount: '', paidOn: this.today(), reference: '', notes: ''};}
  private url(path = '', params = new URLSearchParams()): string {params.set('organizationId', this.organizations.getActiveOrganizationId()); return `/api/v1/debts${path}?${params}`;}
  money(amount: string | number, currency = this.currency): string {
    try {return new Intl.NumberFormat('en-PH', {style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(amount));}
    catch {return `${currency} ${Number(amount).toFixed(2)}`;}
  }
  isOverdue(debt: Debt): boolean {return debt.status !== 'paid' && !!debt.dueOn && debt.dueOn < this.today();}
  private minorUnits(value: string): number | null {
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(String(value))) return null;
    const [whole, decimal = ''] = String(value).split('.'); return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  }
  get validDebt(): boolean {
    const amount = this.minorUnits(this.draft.amount);
    return !!this.draft.title.trim() && !!this.draft.creditor.trim() && amount !== null && amount > 0 && !!this.draft.borrowedOn && (!this.draft.dueOn || this.draft.dueOn >= this.draft.borrowedOn);
  }
  get paymentRemaining(): string | null {
    if (!this.selected) return null;
    const amount = this.minorUnits(this.payment.amount), remaining = this.minorUnits(this.selected.remainingAmount);
    if (amount === null || remaining === null || amount <= 0 || amount > remaining) return null;
    return ((remaining - amount) / 100).toFixed(2);
  }
  get validPayment(): boolean {return this.paymentRemaining !== null && !!this.payment.paidOn && !!this.selected && this.payment.paidOn >= this.selected.borrowedOn;}
  onSearchChange(): void {
    clearTimeout(this.searchTimer); this.listSub?.unsubscribe(); this.page = 1;
    this.searchTimer = setTimeout(() => this.load(), 300);
  }
  filter(): void {this.page = 1; this.load();}
  load(): void {
    clearTimeout(this.searchTimer); this.listSub?.unsubscribe();
    if (!this.organizations.getActiveOrganizationId()) return;
    this.loading = true; this.error = '';
    const params = new URLSearchParams({page: String(this.page)});
    if (this.search.trim()) params.set('q', this.search.trim()); if (this.status) params.set('status', this.status);
    this.listSub = this.api.getFresh<ListData>(this.url('', params)).subscribe({next: response => {
      this.loading = false; this.rows = response.data?.debts || []; this.summary = response.data?.summary || []; this.currency = response.data?.currency || 'PHP';
      this.total = response.meta?.total || 0; this.pages = Math.max(1, response.meta?.totalPages || 1);
      if (this.page > this.pages) {this.page = this.pages; this.load();}
    }, error: error => {this.loading = false; this.error = error?.error?.message || 'Unable to load debts.';}});
  }
  changePage(delta: number): void {const next = this.page + delta; if (this.loading || next < 1 || next > this.pages) return; this.page = next; this.load();}
  openCreate(): void {if (!this.canCreate || this.saving) return; this.draft = this.newDebt(); this.createKey = crypto.randomUUID(); this.createError = ''; this.createOpen = true;}
  closeCreate(): void {if (!this.saving) this.createOpen = false;}
  create(): void {
    if (!this.canCreate || this.saving || !this.validDebt) return;
    this.saving = true; this.createError = ''; this.notice = '';
    this.writes.add(this.api.create<Debt>(this.url(), {...this.draft, requestKey: this.createKey}).subscribe({next: response => {
      this.saving = false; this.createOpen = false; this.notice = 'Debt added.'; this.page = 1; this.load(); if (response.data) this.open(response.data);
    }, error: error => {this.saving = false; this.createError = error?.error?.message || 'Unable to confirm the debt was saved. Retry this form to avoid creating a duplicate.';}}));
  }
  open(debt: Debt): void {
    if (this.saving) return;
    this.selected = debt; this.payments = []; this.paymentPage = 1; this.paymentPages = 1; this.paymentTotal = 0; this.detailError = '';
    this.payment = this.newPayment(); this.paymentKey = crypto.randomUUID(); this.fetchDetail();
  }
  close(): void {if (!this.saving) {this.detailSub?.unsubscribe(); this.selected = null;}}
  fetchDetail(): void {
    if (!this.selected) return;
    this.detailSub?.unsubscribe(); this.detailLoading = true;
    const id = this.selected.id;
    this.detailSub = this.api.getFresh<Detail>(this.url(`/${id}`, new URLSearchParams({page: String(this.paymentPage)}))).subscribe({next: response => {
      this.detailLoading = false; if (this.selected?.id !== id || !response.data) return;
      this.selected = response.data.debt; this.payments = response.data.payments;
      this.paymentTotal = response.meta?.total || 0; this.paymentPages = Math.max(1, response.meta?.totalPages || 1);
    }, error: error => {this.detailLoading = false; this.detailError = error?.error?.message || 'Unable to load payment history.';}});
  }
  changePaymentPage(delta: number): void {const next = this.paymentPage + delta; if (this.detailLoading || next < 1 || next > this.paymentPages) return; this.paymentPage = next; this.fetchDetail();}
  recordPayment(): void {
    if (!this.selected || !this.canPay || this.saving || this.detailLoading || !this.validPayment) return;
    this.saving = true; this.detailError = ''; this.notice = '';
    this.writes.add(this.api.create<{debt: Debt; payment: Payment}>(this.url(`/${this.selected.id}/payments`), {...this.payment, requestKey: this.paymentKey}).subscribe({next: response => {
      this.saving = false; if (response.data) this.selected = response.data.debt;
      this.payment = this.newPayment(); this.paymentKey = crypto.randomUUID(); this.paymentPage = 1;
      this.notice = 'Payment recorded. Remaining balance updated.'; this.fetchDetail(); this.load();
    }, error: error => {this.saving = false; this.detailError = error?.error?.message || 'Unable to confirm the payment. Retry this form to check it without recording it twice.';}}));
  }
}
