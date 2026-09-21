import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, debounceTime, takeUntil } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { MESSAGE_TYPES, OrganizationMessage, messageTarget } from '../../core/organization-message';
import { OrganizationMessagesService } from '../../core/organization-messages.service';
import { SocketNotificationsService } from '../../core/socket-notifications.service';
import { OrganizationRequiredComponent } from '../../shared/organization-required.component';

@Component({
  selector: 'app-messages-page',
  standalone: true,
  imports: [OrganizationRequiredComponent, CommonModule, FormsModule, RouterLink],
  templateUrl: './messages-page.component.html',
  styleUrl: './messages-page.component.css',
})
export class MessagesPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly organizationContext = inject(OrganizationContextService);
  private readonly messages = inject(OrganizationMessagesService);
  private readonly socket = inject(SocketNotificationsService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly destroyed$ = new Subject<void>();
  private readonly searchChanges$ = new Subject<void>();
  private listSub?: Subscription;
  private countSub?: Subscription;
  private readonly newMessageIds = new Set<string>();
  private destroyed = false;
  private lastRequestedQuery = '';
  @ViewChild('messageDialog') private messageDialog?: ElementRef<HTMLDialogElement>;

  readonly rows = signal<OrganizationMessage[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly unreadCount = signal<number | null>(null);
  readonly pendingReadIds = signal(new Set<string>());
  readonly markingAllRead = signal(false);
  readonly selectedMessage = signal<OrganizationMessage | null>(null);
  readonly newMessageCount = signal(0);
  readonly messageTypes = MESSAGE_TYPES;
  page = 1;
  pageSize = 20;
  total = 0;
  totalPages = 1;
  isReadFilter = '';
  entityTypeFilter = '';
  query = '';
  viewMode: 'card' | 'table' = 'card';

  get currentOrganizationId(): string {
    return this.organizationContext.getActiveOrganizationId().trim();
  }

  get isContextLocked(): boolean { return !this.currentOrganizationId; }
  get activeFilterCount(): number { return Number(!!this.query.trim()) + Number(!!this.isReadFilter) + Number(!!this.entityTypeFilter); }
  get hasActiveFilters(): boolean { return this.activeFilterCount > 0; }

  ngOnInit(): void {
    this.searchChanges$.pipe(debounceTime(300), takeUntil(this.destroyed$)).subscribe(() => {
      if (this.query.trim() !== this.lastRequestedQuery) this.applyFilters();
    });
    this.messages.readChanges$.pipe(takeUntil(this.destroyed$)).subscribe((change) => {
      if (change.organizationId && change.organizationId !== this.currentOrganizationId) return;
      const selected = this.selectedMessage();
      if (selected && (!change.messageId || selected.id === change.messageId)) {
        this.selectedMessage.set({ ...selected, isRead: true, readAt: change.readAt });
      }
      this.load();
      this.loadUnreadCount();
    });
    this.socket.messageCreated$.pipe(takeUntil(this.destroyed$)).subscribe((event) => {
      if (event.organizationId !== this.currentOrganizationId || this.newMessageIds.has(event.id)) return;
      this.newMessageIds.add(event.id);
      this.newMessageCount.set(this.newMessageIds.size);
      this.loadUnreadCount();
    });
    this.refresh();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.destroyed$.next();
    this.destroyed$.complete();
    this.listSub?.unsubscribe();
    this.countSub?.unsubscribe();
  }

  refresh(): void {
    this.load();
    this.loadUnreadCount();
  }

  showNewMessages(): void {
    this.page = 1;
    this.refresh();
  }

  load(): void {
    this.listSub?.unsubscribe();
    if (this.isContextLocked) {
      this.rows.set([]);
      this.total = 0;
      this.totalPages = this.page = 1;
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.lastRequestedQuery = this.query.trim();
    const seenMessageIds = [...this.newMessageIds];
    const params = new URLSearchParams({
      organizationId: this.currentOrganizationId, page: String(this.page), limit: String(this.pageSize),
    });
    if (this.isReadFilter) params.set('isRead', String(this.isReadFilter === 'read'));
    if (this.entityTypeFilter) params.set('entityType', this.entityTypeFilter);
    if (this.query.trim()) params.set('q', this.query.trim());
    this.listSub = this.api.list<OrganizationMessage>(`/api/v1/messages?${params}`).subscribe({
      next: (response) => {
        this.total = Number(response.meta?.total || 0);
        this.totalPages = Math.max(1, Number(response.meta?.totalPages || 1));
        if (this.page > this.totalPages) {
          this.page = this.totalPages;
          this.load();
          return;
        }
        this.rows.set(response.data || []);
        this.loading.set(false);
        seenMessageIds.forEach((id) => this.newMessageIds.delete(id));
        this.newMessageCount.set(this.newMessageIds.size);
      },
      error: (err) => {
        this.loading.set(false);
        this.rows.set([]);
        this.error.set(err?.error?.message || 'Unable to load messages. Please try again.');
      },
    });
  }

  private loadUnreadCount(): void {
    this.countSub?.unsubscribe();
    if (this.isContextLocked) return;
    this.countSub = this.api.get<{ unreadCount: number }>(
      `/api/v1/messages/unread-count?organizationId=${encodeURIComponent(this.currentOrganizationId)}`
    ).subscribe({
      next: (response) => this.unreadCount.set(Number(response.data?.unreadCount || 0)),
      error: () => this.unreadCount.set(null),
    });
  }

  onSearchChange(): void { this.searchChanges$.next(); }
  applyFilters(): void {
    this.page = 1;
    this.message.set('');
    this.load();
  }
  clearSearch(): void { this.query = ''; this.applyFilters(); }
  clearFilters(): void {
    this.query = this.isReadFilter = this.entityTypeFilter = '';
    this.applyFilters();
  }
  onPageSizeChange(value: number): void {
    this.pageSize = [10, 20, 50, 100].includes(Number(value)) ? Number(value) : 20;
    this.applyFilters();
  }
  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || this.loading()) return;
    this.page = page;
    this.load();
  }

  openMessage(row: OrganizationMessage): void {
    this.selectedMessage.set(row);
    this.messageDialog?.nativeElement.showModal();
    this.markAsRead(row);
  }
  closeMessage(): void { this.messageDialog?.nativeElement.close(); }

  markAsRead(row: OrganizationMessage): void {
    if (this.isContextLocked || row.isRead || this.pendingReadIds().has(row.id) || this.markingAllRead()) return;
    this.pendingReadIds.update((ids) => new Set([...ids, row.id]));
    this.error.set('');
    this.messages.markRead(row).pipe(takeUntil(this.destroyed$)).subscribe({
      next: () => {
        this.finishRead(row.id);
        this.message.set('Message marked as read for this organization.');
      },
      error: (err) => {
        this.finishRead(row.id);
        this.error.set(err?.error?.message || 'Unable to mark message as read. Please try again.');
      },
    });
  }

  private finishRead(id: string): void {
    this.pendingReadIds.update((ids) => { const next = new Set(ids); next.delete(id); return next; });
  }

  async markAllAsRead(): Promise<void> {
    if (this.isContextLocked || this.markingAllRead() || this.pendingReadIds().size || !this.unreadCount()) return;
    const organizationId = this.currentOrganizationId;
    this.markingAllRead.set(true);
    const confirmed = await this.confirmDialog.confirm({
      title: 'Mark all organization messages as read?',
      message: 'This marks every unread message in this organization as read for everyone, including messages outside your current filters.',
      confirmText: 'Mark all read', confirmButtonClass: 'ui-btn-primary', iconClass: 'bi-check2-all',
    });
    if (!confirmed || this.destroyed || organizationId !== this.currentOrganizationId) {
      this.markingAllRead.set(false);
      return;
    }
    this.error.set('');
    this.messages.markAllRead(organizationId).pipe(takeUntil(this.destroyed$)).subscribe({
      next: (response) => {
        this.markingAllRead.set(false);
        this.message.set(`${response.data?.updatedCount || 0} messages marked as read for this organization.`);
      },
      error: (err) => {
        this.markingAllRead.set(false);
        this.error.set(err?.error?.message || 'Unable to mark all messages as read. Please try again.');
      },
    });
  }

  relatedPath(row: OrganizationMessage): string | null {
    const target = messageTarget(row);
    return target && this.auth.hasPermission(target.permission) ? target.path : null;
  }
  formatTimestamp(value?: string | null): string {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '—';
  }
  creatorLabel(row: OrganizationMessage): string {
    const creator = row.creator;
    return [creator?.firstName, creator?.lastName].filter(Boolean).join(' ').trim() || creator?.email || 'System';
  }
  entityTypeLabel(value?: string): string {
    return MESSAGE_TYPES.find((type) => type.value === value)?.label || (value || 'Notification').replace(/_/g, ' ');
  }
  trackById(_index: number, row: OrganizationMessage): string { return row.id; }
}
