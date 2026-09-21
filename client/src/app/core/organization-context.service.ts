import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class OrganizationContextService {
  private readonly pickerRequests = new Subject<boolean>();
  readonly pickerRequested$ = this.pickerRequests.asObservable();

  requestSelection(requireSpecific = false): void {
    if (this.isSuperuser()) this.pickerRequests.next(requireSpecific);
  }

  readonly ALL_ORGANIZATIONS = '__all__';
  private readonly storageKey = 'selectedOrganizationId';
  private readonly auth = inject(AuthService);

  readonly selectedOrganizationId = signal<string>(this.readStoredSelection());

  isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  getActiveOrganizationId(): string {
    const userOrgId = String(this.auth.currentUser()?.organizationId || '').trim();
    if (!this.isSuperuser()) {
      return userOrgId;
    }

    const selected = String(this.selectedOrganizationId() || '').trim();
    // No stored selection or explicit __all__ → all organizations
    if (!selected || selected === this.ALL_ORGANIZATIONS) {
      return '';
    }
    return selected;
  }

  shouldApplySuperuserScope(): boolean {
    if (!this.isSuperuser()) {
      return false;
    }
    const selected = String(this.selectedOrganizationId() || '').trim();
    return Boolean(selected) && selected !== this.ALL_ORGANIZATIONS;
  }

  isAllOrganizationsSelected(): boolean {
    if (!this.isSuperuser()) {
      return false;
    }
    const selected = String(this.selectedOrganizationId() || '').trim();
    // No stored selection defaults to all organizations for superusers
    return !selected || selected === this.ALL_ORGANIZATIONS;
  }

  setSelectedOrganizationId(organizationId: string): void {
    const normalized = String(organizationId || '').trim();
    this.selectedOrganizationId.set(normalized);
    if (normalized) {
      localStorage.setItem(this.storageKey, normalized);
    } else {
      localStorage.removeItem(this.storageKey);
    }
  }

  clearSelectedOrganizationId(): void {
    this.selectedOrganizationId.set('');
    localStorage.removeItem(this.storageKey);
  }

  private readStoredSelection(): string {
    const stored = String(localStorage.getItem(this.storageKey) || '').trim();
    if (stored) {
      return stored;
    }
    // No stored selection: superusers default to all organizations
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((c) =>
      String(c || '').toLowerCase()
    );
    return roleCodes.includes('superuser') ? this.ALL_ORGANIZATIONS : '';
  }
}
