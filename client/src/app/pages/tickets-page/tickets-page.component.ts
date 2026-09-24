import { CommonModule } from '@angular/common';
import { Component, OnDestroy, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ModalDirective } from '../../shared/modal.directive';
interface Person { id: string; firstName: string; lastName: string; }
interface Customer { id: string; name: string; }
interface Ticket { id: string; subject: string; requesterEmail: string; status: string; priority: number; customerId: string | null; assigneeId: string | null; dueAt: string | null; lastMessageAt: string; version: number; mailboxId?: string; gmailThreadId?: string; customer?: Customer; assignee?: Person; }
interface Message { id: string; kind: string; body: string; sender?: string; createdAt: string; sentAt?: string; deliveryStatus?: string; author?: Person; }
interface Options { users: Person[]; customers: Customer[]; gmailConfigured: boolean; hostingerConfigured?: boolean; automaticSync?: boolean; mailbox: {provider?: string; email: string; connected: boolean; lastSyncedAt?: string; lastError?: string; importing: boolean} | null; }
interface Detail {ticket: Ticket; messages: Message[]; hasMore: boolean;}
@Component({selector: 'app-tickets-page', standalone: true, imports: [CommonModule, FormsModule, ModalDirective], templateUrl: './tickets-page.component.html', styleUrl: './tickets-page.component.css'})
export class TicketsPageComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly organizations = inject(OrganizationContextService);
  readonly statuses = ['open', 'pending', 'resolved', 'closed'];
  readonly priorities = [{id: 1, name: 'Low'}, {id: 2, name: 'Normal'}, {id: 3, name: 'High'}, {id: 4, name: 'Urgent'}];
  rows: Ticket[] = []; options: Options = {users: [], customers: [], gmailConfigured: false, mailbox: null};
  search = ''; status = ''; priority = ''; customer = ''; assignee = ''; sort = 'updated'; overdue = false;
  page = 1; total = 0; pages = 0; loading = false; saving = false; error = ''; notice = ''; detailError = '';
  selected: Ticket | null = null; messages: Message[] = []; hasMore = false; detailLoading = false;
  editStatus = ''; editPriority = 2; editCustomer = ''; editAssignee = ''; editDue = '';
  compose = ''; composeMode = 'note'; private replyKey = crypto.randomUUID();
  hostingerOpen = false; hostingerEmail = ''; hostingerPassword = ''; hostingerProvider = 'hostinger'; hostingerError = '';
  createOpen = false; newSubject = ''; newEmail = ''; newBody = ''; disconnectOpen = false;
  private subscriptions = new Subscription(); private listSub?: Subscription; private detailSub?: Subscription; private optionsSub?: Subscription;
  constructor() {
    effect(() => {
      this.organizations.selectedOrganizationId(); this.auth.currentUser();
      this.subscriptions.unsubscribe(); this.subscriptions = new Subscription();
      this.listSub?.unsubscribe(); this.detailSub?.unsubscribe(); this.optionsSub?.unsubscribe();
      this.hostingerOpen = false; this.hostingerEmail = ''; this.hostingerPassword = ''; this.hostingerError = '';
      this.selected = null; this.messages = []; this.rows = []; this.createOpen = false; this.disconnectOpen = false; this.saving = false;
      this.page = 1; this.customer = ''; this.assignee = ''; this.error = ''; this.notice = ''; this.options = {users: [], customers: [], gmailConfigured: false, mailbox: null};
      if (this.organizations.getActiveOrganizationId()) { this.loadOptions(); this.load(); }
    });
  }
  ngOnDestroy(): void { this.hostingerPassword = ''; this.subscriptions.unsubscribe(); this.listSub?.unsubscribe(); this.detailSub?.unsubscribe(); this.optionsSub?.unsubscribe(); }
  get canManage(): boolean { return this.auth.hasPermission('tickets.manage'); }
  get canReply(): boolean { return this.auth.hasPermission('tickets.reply'); }
  private url(path = '', params = new URLSearchParams()): string { params.set('organizationId', this.organizations.getActiveOrganizationId()); return `/api/v1/tickets${path}?${params}`; }
  name(person?: Person): string { return person ? `${person.firstName} ${person.lastName}` : 'Unassigned'; }
  get isGmail(): boolean { return !this.options.mailbox?.provider || this.options.mailbox.provider === 'gmail'; }
  get mailboxLabel(): string { return this.isGmail ? 'Gmail' : this.options.mailbox?.provider === 'titan' ? 'Titan Email' : 'Hostinger Email'; }
  gmailUrl(ticket: Ticket): string {
    if (!this.isGmail) return this.options.mailbox?.provider === 'titan' ? 'https://app.titan.email/' : 'https://mail.hostinger.com/';
    return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(this.options.mailbox?.email || '')}#all/${encodeURIComponent(ticket.gmailThreadId || '')}`; }
  key(ticket: Ticket): string { return `TKT-${ticket.id.slice(0, 8).toUpperCase()}`; }
  priorityName(value: number): string { return this.priorities.find(item => item.id === value)?.name || 'Normal'; }
  isOverdue(ticket: Ticket): boolean { return !!ticket.dueAt && Date.parse(ticket.dueAt) < Date.now() && ['open', 'pending'].includes(ticket.status); }
  loadOptions(): void {
    this.optionsSub?.unsubscribe();
    this.optionsSub = this.api.getFresh<Options>(this.url('/options')).subscribe({next: response => { if (response.data) this.options = response.data; }, error: error => this.error = error?.error?.message || 'Unable to load ticket settings.'});
  }
  filter(): void { this.page = 1; this.load(); }
  load(): void {
    if (!this.organizations.getActiveOrganizationId()) return;
    this.listSub?.unsubscribe(); this.loading = true; this.error = '';
    const params = new URLSearchParams({page: String(this.page), sort: this.sort});
    for (const [key, value] of Object.entries({q: this.search.trim(), status: this.status, priority: this.priority, customerId: this.customer, assigneeId: this.assignee, overdue: this.overdue ? 'true' : ''})) if (value) params.set(key, value);
    this.listSub = this.api.getFresh<Ticket[]>(this.url('', params)).subscribe({next: response => {this.rows = response.data || []; this.total = response.meta?.total || 0; this.pages = response.meta?.totalPages || 0; this.loading = false;}, error: error => {this.rows = []; this.loading = false; this.error = error?.error?.message || 'Unable to load tickets.';}});
  }
  refresh(): void { this.load(); this.loadOptions(); }
  changePage(delta: number): void { this.page += delta; this.load(); }
  open(ticket: Ticket): void {
    if (this.saving) return;
    this.selected = ticket; this.messages = []; this.compose = ''; this.composeMode = this.canManage ? 'note' : 'reply'; this.replyKey = crypto.randomUUID(); this.detailError = ''; this.fetchDetail();
  }
  fetchDetail(older = false): void {
    if (!this.selected) return;
    const id = this.selected.id; this.detailSub?.unsubscribe(); this.detailLoading = true;
    const params = new URLSearchParams();
    if (older && this.messages.length) { params.set('before', this.messages[0].createdAt); params.set('beforeId', this.messages[0].id); }
    this.detailSub = this.api.getFresh<Detail>(this.url(`/${id}`, params)).subscribe({next: response => {
      this.detailLoading = false; const data = response.data; if (!data || this.selected?.id !== id) return;
      this.selected = data.ticket; this.messages = older ? [...data.messages, ...this.messages] : data.messages; this.hasMore = data.hasMore;
      this.editStatus = data.ticket.status; this.editPriority = data.ticket.priority; this.editCustomer = data.ticket.customerId || ''; this.editAssignee = data.ticket.assigneeId || '';
      const due = data.ticket.dueAt ? new Date(data.ticket.dueAt) : null;
      this.editDue = due ? new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    }, error: error => {this.detailLoading = false; this.detailError = error?.error?.message || 'Unable to load this conversation.';}});
  }
  close(): void { if (!this.saving) {this.detailSub?.unsubscribe(); this.selected = null;} }
  save(): void {
    if (!this.selected || this.saving) return; this.saving = true; this.detailError = '';
    this.subscriptions.add(this.api.put(this.url(`/${this.selected.id}`), {version: this.selected.version, status: this.editStatus, priority: this.editPriority, customerId: this.editCustomer || null, assigneeId: this.editAssignee || null, dueAt: this.editDue ? new Date(this.editDue).toISOString() : null}).subscribe({next: () => {this.saving = false; this.fetchDetail(); this.load();}, error: error => {this.saving = false; this.detailError = error?.error?.message || 'Unable to save ticket.';}}));
  }
  submitMessage(): void {
    if (!this.selected || this.saving || !this.compose.trim()) return;
    this.saving = true; this.detailError = '';
    const isReply = this.composeMode === 'reply';
    this.subscriptions.add(this.api.create<{deliveryStatus: string}>(this.url(`/${this.selected.id}/${isReply ? 'replies' : 'notes'}`), {body: this.compose, requestKey: this.replyKey, version: this.selected.version}).subscribe({next: response => {
      this.saving = false;
      if (isReply && response.data?.deliveryStatus !== 'sent') this.detailError = response.message || 'Check the mailbox Sent folder to confirm delivery.';
      this.compose = ''; this.replyKey = crypto.randomUUID(); this.fetchDetail(); this.load();
    }, error: error => {this.saving = false; this.detailError = error?.error?.message || 'Unable to submit. For replies, check Gmail Sent before trying again.';}}));
  }
  create(): void {
    if (this.saving) return; this.saving = true; this.error = '';
    this.subscriptions.add(this.api.create<Ticket>(this.url(), {subject: this.newSubject, requesterEmail: this.newEmail, body: this.newBody}).subscribe({next: response => {this.saving = false; this.createOpen = false; this.newSubject = ''; this.newEmail = ''; this.newBody = ''; this.load(); if (response.data) this.open(response.data);}, error: error => {this.saving = false; this.error = error?.error?.message || 'Unable to create ticket.';}}));
  }
  openHostinger(): void {
    this.hostingerEmail = this.options.mailbox?.email || '';
    this.hostingerProvider = this.options.mailbox?.provider === 'titan' ? 'titan' : 'hostinger';
    this.hostingerPassword = ''; this.hostingerError = ''; this.hostingerOpen = true;
  }
  closeHostinger(): void { if (!this.saving) {this.hostingerOpen = false; this.hostingerPassword = '';} }
  connectHostinger(): void {
    if (this.saving || !this.hostingerEmail.trim() || !this.hostingerPassword) return;
    this.saving = true; this.hostingerError = '';
    const payload = {email: this.hostingerEmail.trim(), password: this.hostingerPassword, provider: this.hostingerProvider};
    this.subscriptions.add(this.api.create(this.url('/mailbox/hostinger'), payload).subscribe({
      next: response => {this.saving = false; this.hostingerPassword = ''; this.hostingerOpen = false; this.notice = response.message || 'Mailbox connected.'; this.refresh();},
      error: error => {this.saving = false; this.hostingerPassword = ''; this.hostingerError = error?.error?.message || 'Unable to connect the mailbox.';},
    }));
  }
  connect(): void {
    this.saving = true; this.error = '';
    this.subscriptions.add(this.api.create<{url: string}>(this.url('/gmail/connect'), {}).subscribe({next: response => {this.saving = false; if (response.data?.url) window.location.assign(response.data.url);}, error: error => {this.saving = false; this.error = error?.error?.message || 'Unable to connect Gmail.';}}));
  }
  mailboxAction(action: 'sync' | 'disconnect'): void {
    this.saving = true; this.error = '';
    this.subscriptions.add(this.api.create(this.url(`/mailbox/${action}`), {}).subscribe({next: response => {this.saving = false; this.disconnectOpen = false; this.notice = response.message || 'Done.'; this.refresh();}, error: error => {this.saving = false; this.error = error?.error?.message || 'Unable to update the mailbox.';}}));
  }
}
