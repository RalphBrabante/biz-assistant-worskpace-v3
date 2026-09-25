import { ModalDirective } from '../shared/modal.directive';
import { BugReportComponent } from '../shared/bug-report.component';
import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, HostListener, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EMPTY, Subscription, expand, reduce } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ConfirmDialogService } from '../core/confirm-dialog.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { RealtimeMessageEvent, SocketNotificationsService } from '../core/socket-notifications.service';
import { ThemeService } from '../core/theme.service';
import { OrganizationMessage as SidebarMessage, messageTarget } from '../core/organization-message';
import { OrganizationMessagesService } from '../core/organization-messages.service';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  permissions?: string[];
  superuserOnly?: boolean;
  adminOnly?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [BugReportComponent, ModalDirective, CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css',
})
export class AppShellComponent {
  private readonly api = inject(ApiService);
  private readonly messages = inject(OrganizationMessagesService);
  private messageReadSub?: Subscription;
  private notificationListSub?: Subscription;
  private unreadCountSub?: Subscription;
  readonly pendingNotificationReadIds = new Set<string>();
  readonly auth = inject(AuthService);
  readonly confirmDialog = inject(ConfirmDialogService);
  readonly organizationContext = inject(OrganizationContextService);
  private readonly socketNotifications = inject(SocketNotificationsService);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  readonly navSections: NavSection[] = [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', path: '/dashboard', icon: 'bi-speedometer2', permissions: ['dashboard.read'] },
        { label: 'Email tickets', path: '/tickets', icon: 'bi-inbox', permissions: ['tickets.read'] },
        { label: 'Messages', path: '/messages', icon: 'bi-bell', permissions: ['profile.manage'] },
        { label: 'Reports', path: '/reports', icon: 'bi-bar-chart-line', permissions: ['reports.*'] },
      ],
    },
    {
      title: 'Sales',
      items: [
        { label: 'Items', path: '/items', icon: 'bi-box-seam', permissions: ['items.read'] },
        { label: 'Customers', path: '/customers', icon: 'bi-person-vcard', permissions: ['organizations.read'] },
        { label: 'Orders', path: '/orders', icon: 'bi-receipt', permissions: ['orders.read'] },
        { label: 'Sales Invoices', path: '/sales-invoices', icon: 'bi-file-earmark-text', permissions: ['sales_invoices.read'] },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Debt management', path: '/debts', icon: 'bi-journal-text', permissions: ['debts.read'] },
        { label: 'Expenses', path: '/expenses', icon: 'bi-cash-stack', permissions: ['expenses.read'] },
        { label: 'Vendors', path: '/vendors', icon: 'bi-truck', permissions: ['vendors.read'] },
        { label: 'Taxes', path: '/taxes', icon: 'bi-percent', permissions: ['expenses.read'] },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Bug reports', path: '/bug-reports', icon: 'bi-bug', adminOnly: true },
        { label: 'Organizations', path: '/organizations', icon: 'bi-buildings', permissions: ['organizations.read'] },
        { label: 'Users', path: '/users', icon: 'bi-people', permissions: ['users.read'] },
        { label: 'Roles', path: '/roles', icon: 'bi-shield-check', permissions: ['roles.manage'] },
        { label: 'Permissions', path: '/permissions', icon: 'bi-key', permissions: ['permissions.manage'] },
        { label: 'Licenses', path: '/licenses', icon: 'bi-patch-check', permissions: ['licenses.read'] },
        { label: 'Settings', path: '/settings', icon: 'bi-sliders', permissions: ['settings.update'], superuserOnly: true },
      ],
    },
  ];
  @ViewChild('organizationPicker') private organizationPicker?: ElementRef<HTMLDialogElement>;
  private pickerSub?: Subscription;
  private organizationOptionsSub?: Subscription;
  organizationOptionsLoading = false;
  organizationOptionsError = '';
  organizationSearch = '';
  pendingOrganizationId = '';
  requireSpecificOrganization = false;

  get filteredOrganizationOptions() {
    const query = this.organizationSearch.trim().toLocaleLowerCase();
    return this.organizationOptions.filter((org) =>
      [org.name, org.legalName, org.id].some((value) => String(value || '').toLocaleLowerCase().includes(query))
    );
  }

  get canApplyOrganization(): boolean {
    return !this.switchingOrganization && !this.organizationOptionsLoading && !this.organizationOptionsError &&
      this.pendingOrganizationId !== this.selectedOrganizationId &&
      ((!this.requireSpecificOrganization && this.pendingOrganizationId === this.organizationContext.ALL_ORGANIZATIONS) ||
        this.organizationOptions.some((org) => org.id === this.pendingOrganizationId));
  }

  openOrganizationPicker(requireSpecific = false): void {
    if (!this.canSwitchOrganization || this.switchingOrganization) return;
    if (this.sidebarOpen) this.closeSidebar();
    this.requireSpecificOrganization = requireSpecific;
    this.pendingOrganizationId = this.selectedOrganizationId;
    this.organizationSearch = '';
    this.organizationPicker?.nativeElement.showModal();
  }

  closeOrganizationPicker(): void {
    if (!this.switchingOrganization) this.organizationPicker?.nativeElement.close();
  }

  loadOrganizationOptions(): void {
    this.organizationOptionsSub?.unsubscribe();
    this.organizationOptionsLoading = true;
    this.organizationOptionsError = '';
    const fetchPage = (page: number) => this.api.list<{ id: string; name?: string; legalName?: string }>(
      `/api/v1/organizations?limit=100&page=${page}`
    );
    this.organizationOptionsSub = fetchPage(1).pipe(
      expand((response) => {
        const page = response.meta?.page || 1;
        return page < (response.meta?.totalPages || 1) ? fetchPage(page + 1) : EMPTY;
      }),
      reduce((all, response) => [...all, ...(response.data || [])], [] as Array<{ id: string; name?: string; legalName?: string }>)
    ).subscribe({
      next: (organizations) => {
        this.organizationOptions = organizations.sort((a, b) =>
          (a.name || a.legalName || a.id).localeCompare(b.name || b.legalName || b.id)
        );
        this.organizationOptionsLoading = false;
        this.updateDisplayNameFromOptions();
      },
      error: () => {
        this.organizationOptionsLoading = false;
        this.organizationOptionsError = 'Unable to load organizations. Please try again.';
      },
    });
  }

  @ViewChild('sidebarPanel') private sidebarPanel?: ElementRef<HTMLElement>;
  @ViewChild('mobileMenuButton') private mobileMenuButton?: ElementRef<HTMLButtonElement>;
  sidebarOpen = false;
  sidebarCollapsed = false;
  organizationOptions: Array<{ id: string; name?: string; legalName?: string }> = [];
  switchingOrganization = false;
  organizationDisplayName = 'Organization';
  canInstallApp = false;
  installingApp = false;
  unreadMessageCount = 0;
  notificationsOpen = false;
  notificationsLoading = false;
  markingAllRead = false;
  notificationsError = '';
  notifications: SidebarMessage[] = [];
  notificationsPage = 0;
  notificationsLoadFailed = false;
  @ViewChild('notificationViewport') notificationViewport?: ElementRef<HTMLElement>;
  private notificationScrollTimer?: ReturnType<typeof setTimeout>;
  private readonly notificationLiveIds = new Set<string>();
  notificationsTotalPages = 1;
  realtimePopup: SidebarMessage | null = null;
  private unreadCountIntervalId: ReturnType<typeof setInterval> | null = null;
  private realtimePopupTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private audioContext: AudioContext | null = null;
  private allowNotificationSound = false;
  private socketSub?: Subscription;
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

  get userLabel(): string {
    const user = this.auth.currentUser();
    if (!user) {
      return 'Unknown User';
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return fullName || user.email || 'User';
  }

  get userInitials(): string {
    const user = this.auth.currentUser();
    const first = String(user?.firstName || '').trim().charAt(0);
    const last = String(user?.lastName || '').trim().charAt(0);
    const email = String(user?.email || '').trim().charAt(0);
    return `${first}${last}`.trim().toUpperCase() || email.toUpperCase() || 'U';
  }

  get userProfileImageUrl(): string {
    const user = this.auth.currentUser();
    return String(user?.profileImageCdnUrl || user?.profileImageUrl || '').trim();
  }

  logout(): void {
    this.organizationContext.clearSelectedOrganizationId();
    this.auth.clearSession();
    void this.router.navigate(['/login']);
  }

  goToProfile(): void {
    void this.router.navigate(['/profile']);
  }

  openSidebar(): void {
    this.sidebarOpen = true;
    requestAnimationFrame(() => this.sidebarPanel?.nativeElement.querySelector<HTMLButtonElement>('[aria-label="Close navigation"]')?.focus());
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
    this.mobileMenuButton?.nativeElement.focus();
  }

  closeSidebarAfterNav(): void {
    this.sidebarOpen = false;
  }

  @HostListener('document:keydown', ['$event'])
  handleSidebarKeyboard(event: KeyboardEvent): void {
    if (!this.sidebarOpen || window.innerWidth >= 1024) return;
    if (event.key === 'Escape') { event.preventDefault(); this.closeSidebar(); return; }
    if (event.key !== 'Tab') return;
    const links = Array.from(this.sidebarPanel?.nativeElement.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || []).filter(el => el.getClientRects().length && getComputedStyle(el).display !== 'none');
    const first = links[0], last = links.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  toggleSidebarCollapsed(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  readonly visibleNavSections = computed<NavSection[]>(() => {
    const canSee = (item: NavItem): boolean => {
      if (item.adminOnly && !this.auth.isPrivileged()) return false;
      if (item.superuserOnly && !this.organizationContext.isSuperuser()) {
        return false;
      }
      return this.auth.hasAnyPermission(item.permissions || []);
    };

    return this.navSections
      .map((section) => ({
        ...section,
        items: section.items.filter(canSee),
      }))
      .filter((section) => section.items.length > 0);
  });

  get canSwitchOrganization(): boolean {
    return this.organizationContext.isSuperuser();
  }

  get selectedOrganizationId(): string {
    if (!this.canSwitchOrganization) {
      return this.organizationContext.getActiveOrganizationId();
    }
    const selected = String(this.organizationContext.selectedOrganizationId() || '').trim();
    if (selected) {
      return selected;
    }
    // Superuser with no stored selection defaults to all organizations
    return this.organizationContext.ALL_ORGANIZATIONS;
  }

  ngOnInit(): void {
    this.messageReadSub = this.messages.readChanges$.subscribe((change) => {
      const activeId = this.organizationContext.getActiveOrganizationId();
      if (activeId && change.organizationId && activeId !== change.organizationId) return;
      this.notificationListSub?.unsubscribe();
      this.notificationsLoading = false;
      this.notifications = this.notifications.map((row) =>
        (!change.messageId || row.id === change.messageId) && (!change.organizationId || row.organizationId === change.organizationId)
          ? { ...row, isRead: true, readAt: change.readAt } : row
      );
      this.loadUnreadMessageCount();
      this.scheduleNotificationScrollCheck();
    });
    window.addEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.handleAppInstalled);
    window.addEventListener('pointerdown', this.handleFirstUserInteraction, { passive: true });
    window.addEventListener('keydown', this.handleFirstUserInteraction, { passive: true });
    this.resolveOrganizationDisplayName();
    this.initializeRealtimeNotifications();

    if (!this.canSwitchOrganization) {
      this.loadUnreadMessageCount();
      this.startUnreadCountPolling();
      return;
    }

    this.pickerSub = this.organizationContext.pickerRequested$.subscribe((required) => this.openOrganizationPicker(required));
    this.loadOrganizationOptions();

    this.loadUnreadMessageCount();
    this.startUnreadCountPolling();
  }

  ngOnDestroy(): void {
    this.closeNotifications();
    this.messageReadSub?.unsubscribe();
    this.notificationListSub?.unsubscribe();
    this.unreadCountSub?.unsubscribe();
    this.pickerSub?.unsubscribe();
    this.organizationOptionsSub?.unsubscribe();
    window.removeEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', this.handleAppInstalled);
    window.removeEventListener('pointerdown', this.handleFirstUserInteraction);
    window.removeEventListener('keydown', this.handleFirstUserInteraction);
    if (this.unreadCountIntervalId) {
      clearInterval(this.unreadCountIntervalId);
      this.unreadCountIntervalId = null;
    }
    if (this.realtimePopupTimeoutId) {
      clearTimeout(this.realtimePopupTimeoutId);
      this.realtimePopupTimeoutId = null;
    }
    this.socketSub?.unsubscribe();
    this.socketNotifications.disconnect();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
  }

  closeUnauthorizedModal(): void {
    this.auth.clearUnauthorizedAccess();
  }

  closeConfirmModal(): void {
    this.confirmDialog.cancel();
  }

  approveConfirmModal(): void {
    this.confirmDialog.approve();
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  switchOrganization(organizationId: string): void {
    if (!this.canSwitchOrganization) {
      return;
    }
    if (this.switchingOrganization) {
      return;
    }
    const nextOrganizationId = String(organizationId || '').trim();
    const currentOrganizationId = String(this.selectedOrganizationId || '').trim();
    if (nextOrganizationId === currentOrganizationId) {
      return;
    }

    if (!this.canApplyOrganization || nextOrganizationId !== this.pendingOrganizationId) return;
    this.switchingOrganization = true;
    this.organizationContext.setSelectedOrganizationId(nextOrganizationId);
    setTimeout(() => {
      window.location.reload();
    }, 50);
  }

  async installApp(): Promise<void> {
    if (!this.deferredInstallPrompt || this.installingApp) {
      return;
    }

    this.installingApp = true;
    try {
      await this.deferredInstallPrompt.prompt();
      await this.deferredInstallPrompt.userChoice;
    } finally {
      this.deferredInstallPrompt = null;
      this.canInstallApp = false;
      this.installingApp = false;
    }
  }

  private resolveOrganizationDisplayName(): void {
    const organizationId = String(this.selectedOrganizationId || '').trim();
    if (!organizationId) {
      this.organizationDisplayName = 'Organization';
      return;
    }
    if (organizationId === this.organizationContext.ALL_ORGANIZATIONS) {
      this.organizationDisplayName = 'All Organizations';
      return;
    }

    // Non-superusers may not have organizations.read permission; avoid global 403 modal
    // from shell bootstrap calls by using user session fallback labels.
    if (!this.canSwitchOrganization) {
      const user = this.auth.currentUser();
      const fallbackName = String(user?.organizationName || user?.organizationLegalName || '').trim();
      if (fallbackName) {
        this.organizationDisplayName = fallbackName;
        return;
      }

      this.organizationDisplayName = 'Organization';
      this.api.get<{ user?: { organizationName?: string; organizationLegalName?: string; currency?: string } }>(
        '/api/v1/auth/session'
      ).subscribe({
        next: (response) => {
          const sessionUser = response.data?.user;
          const resolvedName = String(
            sessionUser?.organizationName || sessionUser?.organizationLegalName || 'Organization'
          ).trim();
          this.organizationDisplayName = resolvedName || 'Organization';
          if (sessionUser) {
            this.auth.updateCurrentUser({
              organizationName: sessionUser.organizationName,
              organizationLegalName: sessionUser.organizationLegalName,
              currency: sessionUser.currency,
            });
          }
        },
        error: () => {
          this.organizationDisplayName = 'Organization';
        },
      });
      return;
    }

    this.api.get<{ id: string; name?: string; legalName?: string }>(`/api/v1/organizations/${organizationId}`).subscribe({
      next: (response) => {
        const org = response.data;
        this.organizationDisplayName =
          String(org?.name || org?.legalName || organizationId).trim() || 'Organization';
      },
      error: () => {
        this.organizationDisplayName = organizationId;
      },
    });
  }

  private updateDisplayNameFromOptions(): void {
    const organizationId = String(this.selectedOrganizationId || '').trim();
    if (!organizationId) {
      this.organizationDisplayName = 'Organization';
      return;
    }
    if (organizationId === this.organizationContext.ALL_ORGANIZATIONS) {
      this.organizationDisplayName = 'All Organizations';
      return;
    }
    const match = this.organizationOptions.find((org) => org.id === organizationId);
    if (!match) {
      return;
    }
    this.organizationDisplayName =
      String(match.name || match.legalName || organizationId).trim() || 'Organization';
  }

  private readonly handleBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    this.deferredInstallPrompt = event as BeforeInstallPromptEvent;
    this.canInstallApp = true;
  };

  private readonly handleAppInstalled = (): void => {
    this.deferredInstallPrompt = null;
    this.canInstallApp = false;
  };

  private readonly handleFirstUserInteraction = (): void => {
    this.allowNotificationSound = true;
    this.ensureAudioContext();
    window.removeEventListener('pointerdown', this.handleFirstUserInteraction);
    window.removeEventListener('keydown', this.handleFirstUserInteraction);
  };

  trackByNavSection(_index: number, section: NavSection): string {
    return section.title;
  }

  trackByNavItem(_index: number, item: NavItem): string {
    return item.path;
  }

  trackByOrganization(_index: number, org: { id: string }): string {
    return org.id;
  }

  private loadUnreadMessageCount(): void {
    this.unreadCountSub?.unsubscribe();
    const params = new URLSearchParams();
    const activeOrganizationId = String(this.organizationContext.getActiveOrganizationId() || '').trim();
    if (activeOrganizationId) {
      params.set('organizationId', activeOrganizationId);
    }
    const query = params.toString();
    const endpoint = query ? `/api/v1/messages/unread-count?${query}` : '/api/v1/messages/unread-count';

    this.unreadCountSub = this.api.get<{ unreadCount?: number }>(endpoint).subscribe({
      next: (response) => {
        this.unreadMessageCount = Number(response.data?.unreadCount || 0);
      },
      error: () => {
        this.unreadMessageCount = 0;
      },
    });
  }

  private startUnreadCountPolling(): void {
    if (this.unreadCountIntervalId) {
      clearInterval(this.unreadCountIntervalId);
    }
    this.unreadCountIntervalId = setInterval(() => {
      this.loadUnreadMessageCount();
    }, 30000);
  }

  closeRealtimePopup(): void {
    this.realtimePopup = null;
    if (this.realtimePopupTimeoutId) {
      clearTimeout(this.realtimePopupTimeoutId);
      this.realtimePopupTimeoutId = null;
    }
  }

  openNotification(row: SidebarMessage, markAsRead = true): void {
    if (!row?.id) {
      return;
    }
    if (markAsRead && !row.isRead) {
      this.markNotificationAsRead(row);
    }

    const path = this.resolveNotificationPath(row);
    this.closeRealtimePopup();
    this.closeNotifications();
    void this.router.navigateByUrl(path);
  }

  toggleNotifications(): void {
    if (this.notificationsOpen) {
      this.closeNotifications();
      return;
    }
    this.notificationsOpen = true;
    this.loadNotifications(1, false);
  }

  closeNotifications(): void {
    this.notificationsOpen = false;
    this.notificationListSub?.unsubscribe();
    this.notificationsLoading = false;
    if (this.notificationScrollTimer) clearTimeout(this.notificationScrollTimer);
  }

  onNotificationsScroll(): void {
    const viewport = this.notificationViewport?.nativeElement;
    if (!viewport || !this.notificationsOpen || this.notificationsLoadFailed) return;
    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 100) {
      this.loadMoreNotifications();
    }
  }

  private scheduleNotificationScrollCheck(): void {
    if (this.notificationScrollTimer) clearTimeout(this.notificationScrollTimer);
    if (!this.notificationsOpen) return;
    // Wait for Angular to render the new rows before measuring the scroll area.
    this.notificationScrollTimer = setTimeout(() => this.onNotificationsScroll(), 0);
  }

  retryNotifications(): void {
    this.loadNotifications(this.notificationsPage + 1, this.notificationsPage > 0);
  }

  loadMoreNotifications(): void {
    if (!this.notificationsOpen || this.notificationsLoading || this.notificationsLoadFailed || this.notificationsPage >= this.notificationsTotalPages) {
      return;
    }
    this.loadNotifications(this.notificationsPage + 1, true);
  }

  get hasUnreadNotifications(): boolean {
    return this.unreadMessageCount > 0;
  }

  markAllAsRead(): void {
    if (this.markingAllRead || !this.hasUnreadNotifications) {
      return;
    }
    this.markingAllRead = true;
    this.notificationsError = '';
    const organizationId = this.organizationContext.getActiveOrganizationId();
    this.messages.markAllRead(organizationId).subscribe({
      next: () => { this.markingAllRead = false; },
      error: (err) => {
        this.markingAllRead = false;
        this.notificationsError = err?.error?.message || 'Unable to mark notifications as read. Please try again.';
      },
    });
  }

  markNotificationAsRead(row: SidebarMessage): void {
    if (!row?.id || row.isRead || this.pendingNotificationReadIds.has(row.id) || this.markingAllRead) return;
    this.pendingNotificationReadIds.add(row.id);
    this.notificationsError = '';
    this.messages.markRead(row).subscribe({
      next: () => { this.pendingNotificationReadIds.delete(row.id); },
      error: (err) => {
        this.pendingNotificationReadIds.delete(row.id);
        this.notificationsError = err?.error?.message || 'Unable to mark notification as read. Please try again.';
      },
    });
  }

  notificationTimestamp(value?: string): string {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString();
  }

  trackByMessage(_index: number, row: SidebarMessage): string {
    return row.id;
  }

  loadNotifications(page = 1, append = false): void {
    this.notificationListSub?.unsubscribe();
    this.notificationsLoading = true;
    this.notificationsError = '';
    this.notificationsLoadFailed = false;
    if (!append) {
      this.notifications = [];
      this.notificationsPage = 0;
      this.notificationsTotalPages = 1;
      this.notificationLiveIds.clear();
      if (this.notificationViewport) this.notificationViewport.nativeElement.scrollTop = 0;
    }

    const params = new URLSearchParams({
      page: String(page),
      limit: '10',
    });
    const activeOrganizationId = String(this.organizationContext.getActiveOrganizationId() || '').trim();
    if (activeOrganizationId) {
      params.set('organizationId', activeOrganizationId);
    }

    this.notificationListSub = this.api.list<SidebarMessage>(`/api/v1/messages?${params.toString()}`).subscribe({
      next: (response) => {
        const rows = response.data || [];
        const existing = append ? this.notifications : this.notifications.filter((row) => this.notificationLiveIds.has(row.id));
        const seen = new Set(existing.map((row) => row.id));
        this.notifications = [...existing, ...rows.filter((row) => {
          if (seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        })];
        this.notificationsPage = Number(response.meta?.page || page);
        this.notificationsTotalPages = Math.max(1, Number(response.meta?.totalPages || 1));
        this.notificationsLoading = false;
        if (rows.length === 0) this.notificationsTotalPages = this.notificationsPage;
        this.scheduleNotificationScrollCheck();
      },
      error: (err) => {
        this.notificationsLoading = false;
        this.notificationsLoadFailed = true;
        this.notificationsError = err?.error?.message || 'Unable to load notifications.';
      },
    });
  }

  private initializeRealtimeNotifications(): void {
    const token = String(this.auth.token() || '').trim();
    if (!token) {
      return;
    }
    const organizationId = String(this.organizationContext.getActiveOrganizationId() || '').trim();
    this.socketNotifications.connect(token, organizationId);

    this.socketSub?.unsubscribe();
    this.socketSub = this.socketNotifications.messageCreated$.subscribe((event) => {
      this.handleRealtimeMessage(event);
    });
  }

  private handleRealtimeMessage(event: RealtimeMessageEvent): void {
    const organizationId = this.organizationContext.getActiveOrganizationId();
    if (organizationId && event.organizationId !== organizationId) return;
    if (this.notifications.some((row) => row.id === event.id)) return;
    const row: SidebarMessage = {
      id: event.id,
      organizationId: event.organizationId,
      entityType: event.entityType,
      entityId: event.entityId || null,
      title: event.title,
      message: event.message,
      metadata: event.metadata || null,
      isRead: false,
      readAt: null,
      createdAt: event.createdAt,
    };

    this.unreadMessageCount += 1;
    this.playNotificationChime();
    this.realtimePopup = row;
    if (this.realtimePopupTimeoutId) {
      clearTimeout(this.realtimePopupTimeoutId);
    }
    this.realtimePopupTimeoutId = setTimeout(() => {
      this.realtimePopup = null;
      this.realtimePopupTimeoutId = null;
    }, 5000);

    if (this.notificationsOpen) {
      const exists = this.notifications.some((message) => message.id === row.id);
      if (!exists) {
        this.notificationLiveIds.add(row.id);
        this.notifications = [row, ...this.notifications];
      }
    }
  }

  private ensureAudioContext(): AudioContext | null {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume().catch(() => undefined);
    }
    return this.audioContext;
  }

  private playNotificationChime(): void {
    if (!this.allowNotificationSound) {
      return;
    }
    const context = this.ensureAudioContext();
    if (!context) {
      return;
    }

    try {
      const startAt = context.currentTime;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.35);
      gain.connect(context.destination);

      const toneA = context.createOscillator();
      toneA.type = 'sine';
      toneA.frequency.setValueAtTime(740, startAt);
      toneA.connect(gain);
      toneA.start(startAt);
      toneA.stop(startAt + 0.16);

      const toneB = context.createOscillator();
      toneB.type = 'sine';
      toneB.frequency.setValueAtTime(988, startAt + 0.18);
      toneB.connect(gain);
      toneB.start(startAt + 0.18);
      toneB.stop(startAt + 0.34);
    } catch (_err) {
      // Ignore audio playback failures to avoid breaking notification flow.
    }
  }

  private resolveNotificationPath(row: SidebarMessage): string {
    return messageTarget(row)?.path || '/messages';
  }
}
