import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ChatMessage, ChatService, ChatUser } from '../core/chat.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { SocketNotificationsService } from '../core/socket-notifications.service';
import { ChatSoundService } from '../core/chat-sound.service';
import { chatInitials, chatTimestamp, chatDateTime } from '../core/chat-display';

@Component({
  selector: 'app-chat-panel', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './chat-panel.component.html', styleUrl: './chat-panel.component.css',
})
export class ChatPanelComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  private readonly chat = inject(ChatService);
  readonly organizations = inject(OrganizationContextService);
  private readonly sockets = inject(SocketNotificationsService);
  readonly sound = inject(ChatSoundService);
  readonly initials = chatInitials;
  readonly timestamp = chatTimestamp;
  readonly dateTime = chatDateTime;
  private readonly failedPhotos = new Set<string>();
  private incomingInitialized = false;
  private latestIncoming: { id: string; createdAt: string } | null = null;
  private unreadRefreshQueued = false;
  @ViewChild('launcher') launcher?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('composer') composer?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('messageList') messageList?: ElementRef<HTMLElement>;
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;
  private subscriptions = new Subscription();
  private readonly socketSubscription: Subscription;
  private readonly pollTimer: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private usersRequest?: Subscription;
  private messageRequest?: Subscription;
  private contextVersion = 0;
  private userVersion = 0;
  private organizationId = '';
  private identity = '';
  private nextUnreadCheck = 0;
  private unreadPending = false;
  private messagesPending = false;
  private historyCursor = '';
  private readPending = false;
  private retry?: { userId: string; body: string; id: string };
  open = false;
  users: ChatUser[] = [];
  selected?: ChatUser;
  messages: ChatMessage[] = [];
  search = '';
  draft = '';
  error = '';
  usersError = '';
  unreadTotal = 0;
  unreadCounts: Record<string, number> = {};
  usersLoading = false;
  messagesLoading = false;
  sending = false;
  olderLoading = false;
  hasOlder = false;
  usersPage = 1;
  hasMoreUsers = false;

  constructor() {
    effect(() => {
      const org = this.organizations.getActiveOrganizationId();
      const identity = this.auth.isAuthenticated() ? this.auth.currentUser()?.id || '' : '';
      if (org !== this.organizationId || identity !== this.identity) this.reset(org, identity);
    });
    this.socketSubscription = this.sockets.chatChanged$.subscribe(event => {
      if (event.organizationId !== this.organizationId || !this.auth.isAuthenticated()) return;
      this.refreshUnread();
      if (this.open && this.selected) this.loadMessages();
    });
    this.pollTimer = setInterval(() => {
      if (!this.auth.isAuthenticated() || !this.organizationId || document.visibilityState === 'hidden') return;
      if (Date.now() >= this.nextUnreadCheck) this.refreshUnread();
      if (this.open && this.selected) this.loadMessages();
    }, 5000);
  }
  private reset(org: string, identity: string): void {
    this.contextVersion++;
    this.userVersion++;
    this.subscriptions.unsubscribe(); this.subscriptions = new Subscription();
    clearTimeout(this.searchTimer);
    this.organizationId = org; this.identity = identity;
    this.open = false; this.selected = undefined; this.users = []; this.messages = [];
    this.draft = ''; this.search = ''; this.error = ''; this.usersError = ''; this.retry = undefined;
    this.unreadTotal = 0; this.unreadCounts = {}; this.unreadPending = false;
    this.incomingInitialized = false; this.latestIncoming = null; this.unreadRefreshQueued = false; this.failedPhotos.clear();
    this.messagesPending = false; this.readPending = false; this.usersLoading = false;
    this.historyCursor = '';
    this.messagesLoading = false; this.olderLoading = false; this.sending = false;
    this.hasOlder = false; this.hasMoreUsers = false; this.usersPage = 1;
    if (org && identity) this.refreshUnread();
  }
  toggle(): void {
    if (this.open) { this.close(); return; }
    this.open = true;
    if (this.organizationId) { this.loadUsers(); this.refreshUnread(); }
    if (this.selected) this.loadMessages();
    this.focus(this.selected ? 'composer' : 'search');
  }
  close(): void { this.open = false; this.launcher?.nativeElement.focus(); }
  @HostListener('document:keydown.escape', ['$event'])
  escape(event: KeyboardEvent): void {
    if (this.open && this.panel?.nativeElement.contains(event.target as Node)) { event.stopPropagation(); this.close(); }
  }
  name(user: ChatUser): string { return [user.firstName, user.lastName].map(value => (value || '').trim()).filter(Boolean).join(' ') || user.email; }
  photo(user: ChatUser): string {
    return [user.profileImageCdnUrl, user.profileImageUrl].map(url => String(url || '').trim())
      .find(url => url && !this.failedPhotos.has(url)) || '';
  }
  photoFailed(user: ChatUser, event: Event): void {
    const url = (event.target as HTMLImageElement).getAttribute('src') || this.photo(user);
    if (url) this.failedPhotos.add(url);
  }
  searchChanged(): void {
    clearTimeout(this.searchTimer);
    // Cancel immediately so a response for an old search cannot replace results.
    this.usersRequest?.unsubscribe();
    this.userVersion++;
    this.searchTimer = setTimeout(() => this.loadUsers(), 250);
  }
  loadUsers(more = false): void {
    if (!this.organizationId || !this.auth.isAuthenticated()) return;
    this.usersRequest?.unsubscribe();
    const context = this.contextVersion, version = ++this.userVersion;
    const page = more ? this.usersPage + 1 : 1;
    this.usersLoading = true; this.usersError = '';
    this.usersRequest = this.chat.users(this.organizationId, this.search, page).subscribe({
      next: response => {
        if (context !== this.contextVersion || version !== this.userVersion) return;
        this.users = more ? [...this.users, ...(response.data || [])] : response.data || [];
        this.usersPage = page; this.hasMoreUsers = page < (response.meta?.totalPages || 0); this.usersLoading = false;
      },
      error: error => { if (context === this.contextVersion && version === this.userVersion) { this.usersError = this.errorText(error, 'Unable to load members. Please retry.'); this.usersLoading = false; } },
    });
    this.subscriptions.add(this.usersRequest);
  }
  select(user: ChatUser): void {
    if (this.sending) return;
    this.messageRequest?.unsubscribe(); this.messagesPending = false;
    this.selected = user; this.messages = []; this.draft = ''; this.error = ''; this.retry = undefined;
    this.historyCursor = '';
    this.hasOlder = false; this.messagesLoading = true; this.olderLoading = false;
    this.loadMessages(); this.focus('composer');
  }
  back(): void {
    if (this.sending) return;
    this.selected = undefined; this.messages = []; this.draft = ''; this.error = ''; this.retry = undefined;
    this.historyCursor = '';
    this.messageRequest?.unsubscribe(); this.messagesPending = false; this.messagesLoading = false; this.olderLoading = false;
    this.loadUsers(); this.focus('search');
  }
  loadMessages(older = false): void {
    if (!this.selected || this.messagesPending || !this.open || document.visibilityState === 'hidden') return;
    const peer = this.selected.id, context = this.contextVersion;
    const list = this.messageList?.nativeElement;
    const previousHeight = list?.scrollHeight || 0, previousTop = list?.scrollTop || 0;
    const atBottom = !list || previousHeight - previousTop - list.clientHeight < 80;
    const wasEmpty = this.messages.length === 0;
    const incremental = !older && Boolean(this.historyCursor);
    this.messagesPending = true; this.olderLoading = older;
    this.messageRequest = this.chat.history(this.organizationId, peer, older ? this.messages[0]?.id : '', incremental ? this.historyCursor : '').subscribe({
      next: response => {
        if (context !== this.contextVersion || peer !== this.selected?.id) return;
        const loaded = response.data || [];
        // Only server history advances the cursor. A just-sent local message
        // must not skip incoming messages created since our previous refresh.
        if (!older && loaded.length) this.historyCursor = loaded[loaded.length - 1].id;
        this.messages = this.merge(this.messages, loaded);
        const readThrough = response.meta?.readThrough;
        if (readThrough) this.messages = this.messages.map(row => row.senderUserId === this.identity && !row.readAt &&
          (Date.parse(row.createdAt) < Date.parse(readThrough.createdAt) || (row.createdAt === readThrough.createdAt && row.id <= readThrough.id))
          ? { ...row, readAt: readThrough.readAt } : row);
        if (older || !incremental) this.hasOlder = response.meta?.hasMore || false;
        this.messagesPending = false; this.messagesLoading = false; this.olderLoading = false;
        setTimeout(() => {
          if (context !== this.contextVersion || peer !== this.selected?.id || !this.open) return;
          const element = this.messageList?.nativeElement;
          if (element && older) element.scrollTop = previousTop + element.scrollHeight - previousHeight;
          else if (element && (wasEmpty || atBottom)) element.scrollTop = element.scrollHeight;
          if (!older && (wasEmpty || atBottom)) this.markRead();
          // Catch up in bounded pages after reconnecting or a long absence.
          if (incremental && response.meta?.hasMore) this.loadMessages();
        });
      },
      error: error => {
        if (context !== this.contextVersion || peer !== this.selected?.id) return;
        this.error = this.errorText(error, 'Unable to load messages. Please retry.');
        this.messagesPending = false; this.messagesLoading = false; this.olderLoading = false;
        if (error?.status === 403) { this.messages = []; this.historyCursor = ''; }
      },
    });
    this.subscriptions.add(this.messageRequest);
  }
  messageScrolled(): void {
    const list = this.messageList?.nativeElement;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 40) this.markRead();
  }
  private markRead(): void {
    if (!this.open || !this.selected || this.readPending || document.visibilityState === 'hidden') return;
    const incoming = this.messages.filter(row => row.recipientUserId === this.identity && !row.readAt).at(-1);
    if (!incoming) return;
    const context = this.contextVersion, peer = this.selected.id;
    this.readPending = true;
    this.subscriptions.add(this.chat.read(this.organizationId, peer, incoming.id).subscribe({
      next: () => {
        if (context !== this.contextVersion) return;
        this.readPending = false;
        if (peer === this.selected?.id) {
          // Only acknowledge messages at or before the boundary actually shown.
          const boundary = this.messages.findIndex(row => row.id === incoming.id);
          this.messages = this.messages.map((row, index) => index <= boundary && row.recipientUserId === this.identity && !row.readAt ? { ...row, readAt: new Date().toISOString() } : row);
        }
        this.refreshUnread();
      },
      error: () => { if (context === this.contextVersion) this.readPending = false; },
    }));
  }
  send(): void {
    const body = this.draft.trim();
    if (this.sending || !this.selected || !body) return;
    if (body.length > 4000) { this.error = 'Keep your message within 4,000 characters.'; return; }
    const peer = this.selected.id, context = this.contextVersion;
    if (!this.retry || this.retry.userId !== peer || this.retry.body !== body) this.retry = { userId: peer, body, id: crypto.randomUUID() };
    this.sending = true; this.error = '';
    this.subscriptions.add(this.chat.send(this.organizationId, peer, body, this.retry.id).subscribe({
      next: response => {
        if (context !== this.contextVersion || peer !== this.selected?.id) return;
        this.sending = false;
        if (!response.data) { this.error = 'Message confirmation was missing. Please retry.'; return; }
        this.messages = this.merge(this.messages, [response.data]); this.draft = ''; this.retry = undefined;
        this.focus('composer');
        setTimeout(() => { if (context === this.contextVersion && peer === this.selected?.id && this.messageList) this.messageList.nativeElement.scrollTop = this.messageList.nativeElement.scrollHeight; });
      },
      error: error => {
        if (context !== this.contextVersion || peer !== this.selected?.id) return;
        this.sending = false; this.error = this.errorText(error, 'Message could not be sent. Your draft is saved here; retry to send.');
        if (error?.status === 403) { this.messages = []; this.historyCursor = ''; }
      },
    }));
  }
  composerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); this.send(); }
  }
  refreshUnread(): void {
    if (!this.organizationId || !this.identity) return;
    if (this.unreadPending) { this.unreadRefreshQueued = true; return; }
    const context = this.contextVersion;
    this.unreadPending = true; this.nextUnreadCheck = Date.now() + 30000;
    this.subscriptions.add(this.chat.unread(this.organizationId).subscribe({
      next: response => {
        if (context !== this.contextVersion) return;
        const incoming = response.data?.latestIncoming;
        // Keep a high watermark when membership changes hide a sender's messages.
        // Restoring access must not replay sounds for older conversations.
        if (incoming && (!this.latestIncoming || Date.parse(incoming.createdAt) > Date.parse(this.latestIncoming.createdAt) ||
          (incoming.createdAt === this.latestIncoming.createdAt && incoming.id > this.latestIncoming.id))) {
          if (this.incomingInitialized) this.sound.play();
          this.latestIncoming = incoming;
        }
        this.incomingInitialized = true;
        this.unreadTotal = response.data?.total || 0; this.unreadCounts = response.data?.counts || {}; this.unreadPending = false;
        if (this.unreadRefreshQueued) { this.unreadRefreshQueued = false; this.refreshUnread(); }
      },
      error: () => { if (context === this.contextVersion) { this.unreadPending = false; this.unreadRefreshQueued = false; this.unreadTotal = 0; this.unreadCounts = {}; } },
    }));
  }
  private merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    const rows = new Map(current.map(row => [row.id, row]));
    for (const row of incoming) rows.set(row.id, row);
    return [...rows.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  }
  private focus(target: 'search' | 'composer'): void {
    const context = this.contextVersion;
    setTimeout(() => { if (context === this.contextVersion && this.open) (target === 'search' ? this.searchInput : this.composer)?.nativeElement.focus(); });
  }
  private errorText(error: any, fallback: string): string { return error?.error?.message || fallback; }
  trackUser(_index: number, user: ChatUser): string { return user.id; }
  trackMessage(_index: number, message: ChatMessage): string { return message.id; }
  ngOnDestroy(): void {
    this.contextVersion++; clearInterval(this.pollTimer); clearTimeout(this.searchTimer);
    this.subscriptions.unsubscribe(); this.socketSubscription.unsubscribe();
  }
}
