import { Injectable } from '@angular/core';
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
export class SocketNotificationsService {
  private socket: Socket | null = null;
  private readonly messageCreatedSubject = new Subject<RealtimeMessageEvent>();
  readonly messageCreated$ = this.messageCreatedSubject.asObservable();

  connect(token: string, organizationId: string): void {
    const authToken = String(token || '').trim();
    if (!authToken) {
      return;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.socket = io('/', {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      auth: {
        token: authToken,
        organizationId: String(organizationId || '').trim(),
      },
    });

    this.socket.on('message.created', (payload: RealtimeMessageEvent) => {
      if (!payload || !payload.id) {
        return;
      }
      this.messageCreatedSubject.next(payload);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

