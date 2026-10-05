import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';

export interface RealtimeMessageEvent {
  id: string;
  organizationId: string;
  entityType?: string;
  entityId?: string | null;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  isRead?: boolean;
  readAt?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class SocketNotificationsService implements OnDestroy {
  private socket: Socket | null = null;
  private readonly messageCreatedSubject = new Subject<RealtimeMessageEvent>();
  readonly messageCreated$ = this.messageCreatedSubject.asObservable();
  private readonly chatChangedSubject = new Subject<{ organizationId: string }>();
  readonly chatChanged$ = this.chatChangedSubject.asObservable();
  private readonly presenceChangedSubject = new Subject<{ organizationId: string }>();
  readonly presenceChanged$ = this.presenceChangedSubject.asObservable();
  private lastActivity = Date.now();
  private silent = false;
  private presenceTimer?: ReturnType<typeof setInterval>;
  private lastPresence = '';
  private readonly activity = () => {
    this.lastActivity = Date.now();
    if (this.lastPresence === 'away') this.publishPresence();
  };
  private readonly visibility = () => this.publishPresence();

  constructor() {
    window.addEventListener('pointerdown', this.activity);
    window.addEventListener('keydown', this.activity);
    document.addEventListener('visibilitychange', this.visibility);
  }
  setChatSilent(silent: boolean): void {
    if (this.silent === silent) return;
    this.silent = silent; this.publishPresence();
  }
  private publishPresence(): void {
    if (!this.socket?.connected) return;
    const status = this.silent ? 'silent' : document.visibilityState === 'hidden' || Date.now() - this.lastActivity >= 300000 ? 'away' : 'online';
    this.lastPresence = status;
    this.socket.emit('chat.presence', { status });
  }

  connect(token: string, organizationId: string): void {
    const authToken = String(token || '').trim();
    if (!authToken) {
      return;
    }

    this.disconnect();

    this.socket = io('/', {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      auth: {
        token: authToken,
        organizationId: String(organizationId || '').trim(),
      },
    });

    this.socket.on('connect', () => { this.lastPresence = ''; this.publishPresence(); });
    this.socket.on('chat.presence.changed', (payload: { organizationId: string }) => {
      if (payload?.organizationId) this.presenceChangedSubject.next(payload);
    });
    this.presenceTimer = setInterval(() => this.publishPresence(), 30000);

    this.socket.on('chat.changed', (payload: { organizationId: string }) => {
      if (payload?.organizationId) this.chatChangedSubject.next(payload);
    });

    this.socket.on('message.created', (payload: RealtimeMessageEvent) => {
      if (!payload || !payload.id) {
        return;
      }
      this.messageCreatedSubject.next(payload);
    });
  }

  disconnect(): void {
    clearInterval(this.presenceTimer); this.presenceTimer = undefined; this.lastPresence = '';
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
  ngOnDestroy(): void {
    this.disconnect();
    window.removeEventListener('pointerdown', this.activity);
    window.removeEventListener('keydown', this.activity);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}
