import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { timeout } from 'rxjs';

export interface ChatUser { id: string; firstName?: string; lastName?: string; email: string; profileImageUrl?: string; profileImageCdnUrl?: string; }
export type ChatPresenceStatus = 'online' | 'away' | 'silent' | 'offline' | 'unknown';
export interface ChatPresence { userId: string; status: ChatPresenceStatus; }
export interface ChatReply { id: string; senderUserId: string; body: string; createdAt: string; }
export interface ChatMessage {
  id: string; organizationId: string; senderUserId: string; recipientUserId: string;
  clientMessageId: string; body: string; createdAt: string; readAt: string | null;
  replyToMessageId?: string | null; replyTo?: ChatReply | null;
}
export interface ChatResponse<T> {
  data?: T;
  meta?: { page?: number; totalPages?: number; hasMore?: boolean; before?: string | null; readThrough?: { id: string; createdAt: string; readAt: string } | null };
}
export interface ChatUnread { total: number; counts: Record<string, number>; latestIncoming?: { id: string; createdAt: string } | null; }

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly headers = new HttpHeaders({ 'ngsw-bypass': 'true', 'Cache-Control': 'no-cache' });
  private url(org: string, path: string, params: Record<string, string> = {}): string {
    return `/api/v1/chat/${path}?${new URLSearchParams({ organizationId: org, ...params })}`;
  }
  users(org: string, search = '', page = 1) {
    return this.http.get<ChatResponse<ChatUser[]>>(this.url(org, 'users', { search, page: String(page) }), { headers: this.headers }).pipe(timeout(15000));
  }
  unread(org: string) {
    return this.http.get<ChatResponse<ChatUnread>>(this.url(org, 'unread'), { headers: this.headers }).pipe(timeout(15000));
  }
  presence(org: string) {
    return this.http.get<ChatResponse<ChatPresence[]>>(this.url(org, 'presence'), { headers: this.headers }).pipe(timeout(15000));
  }
  history(org: string, userId: string, before = '', after = '') {
    return this.http.get<ChatResponse<ChatMessage[]>>(this.url(org, `users/${userId}/messages`, before ? { before } : after ? { after } : {}), { headers: this.headers }).pipe(timeout(15000));
  }
  send(org: string, userId: string, body: string, clientMessageId: string, replyToMessageId: string | null = null) {
    return this.http.post<ChatResponse<ChatMessage>>(this.url(org, `users/${userId}/messages`), { body, clientMessageId, replyToMessageId }, { headers: this.headers }).pipe(timeout(15000));
  }
  read(org: string, userId: string, throughId: string) {
    return this.http.post(this.url(org, `users/${userId}/read`), { throughId }, { headers: this.headers }).pipe(timeout(15000));
  }
}
