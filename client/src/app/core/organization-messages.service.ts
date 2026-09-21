import { Injectable, inject } from '@angular/core';
import { Subject, tap } from 'rxjs';
import { ApiService } from './api.service';
import { OrganizationMessage } from './organization-message';

export interface MessageReadChange {
  organizationId: string;
  messageId?: string;
  readAt: string;
}

@Injectable({ providedIn: 'root' })
export class OrganizationMessagesService {
  private readonly api = inject(ApiService);
  private readonly changes = new Subject<MessageReadChange>();
  readonly readChanges$ = this.changes.asObservable();

  markRead(row: OrganizationMessage) {
    return this.api.put<OrganizationMessage>(`/api/v1/messages/${encodeURIComponent(row.id)}/read`, {}).pipe(
      tap((response) => this.changes.next({
        organizationId: response.data?.organizationId || row.organizationId || '',
        messageId: row.id,
        readAt: response.data?.readAt || new Date().toISOString(),
      }))
    );
  }

  markAllRead(organizationId: string) {
    const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : '';
    return this.api.put<{ updatedCount: number }>(`/api/v1/messages/read-all${query}`, {}).pipe(
      tap(() => this.changes.next({ organizationId, readAt: new Date().toISOString() }))
    );
  }
}
