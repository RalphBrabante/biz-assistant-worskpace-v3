import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';
import { ApiResponse } from '../../core/types';
import { StorageMigrationComponent } from './storage-migration.component';

interface CacheSettingPayload {
  key: string;
  enabled: boolean;
}

interface StorageSettingPayload {
  provider: 'local' | 'do_spaces' | 'google_drive';
  uploadTargets: {
    expenseAttachment: 'local' | 'do_spaces' | 'google_drive';
    profileImage: 'local' | 'do_spaces' | 'google_drive';
  };
  doSpaces: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    hasSecretKey: boolean;
    cdnBaseUrl: string;
    directory: string;
  };
  googleDrive: {
    clientId: string;
    clientSecret: string;
    hasClientSecret: boolean;
    redirectUri: string;
    folderId: string;
    accountEmail: string;
    hasRefreshToken: boolean;
    scope: string;
  };
  isDoSpacesConfigured: boolean;
  isGoogleDriveConfigured: boolean;
}

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CommonModule, FormsModule, StorageMigrationComponent],
  templateUrl: './settings-page.component.html',
})
export class SettingsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly cacheEnabled = signal(true);
  readonly storageProvider = signal<'local' | 'do_spaces' | 'google_drive'>('local');
  readonly expenseAttachmentProvider = signal<'local' | 'do_spaces' | 'google_drive'>('local');
  readonly profileImageProvider = signal<'local' | 'do_spaces' | 'google_drive'>('local');
  readonly doSpacesEndpoint = signal('');
  readonly doSpacesRegion = signal('');
  readonly doSpacesBucket = signal('');
  readonly doSpacesAccessKey = signal('');
  readonly doSpacesSecretKey = signal('');
  readonly doSpacesHasSecretKey = signal(false);
  readonly doSpacesCdnBaseUrl = signal('');
  readonly doSpacesDirectory = signal('');
  readonly doSpacesConfigured = signal(false);

  readonly googleDriveClientId = signal('');
  readonly googleDriveClientSecret = signal('');
  readonly googleDriveHasClientSecret = signal(false);
  readonly googleDriveRedirectUri = signal('');
  readonly googleDriveFolderId = signal('');
  readonly googleDriveAccountEmail = signal('');
  readonly googleDriveConnected = signal(false);

  get requiresDoSpaces(): boolean {
    return [this.storageProvider(), this.expenseAttachmentProvider(), this.profileImageProvider()].includes('do_spaces');
  }

  get requiresGoogleDrive(): boolean {
    return [this.storageProvider(), this.expenseAttachmentProvider(), this.profileImageProvider()].includes('google_drive');
  }

  get isSuperuser(): boolean {
    const roleCodes = (this.auth.currentUser()?.roleCodes || []).map((code) =>
      String(code || '').toLowerCase()
    );
    return roleCodes.includes('superuser');
  }

  ngOnInit(): void {
    const currentUrl = new URL(window.location.href);
    const gdriveState = String(currentUrl.searchParams.get('gdrive') || '').trim();
    if (gdriveState) {
      if (gdriveState === 'connected') {
        this.message.set('Google Drive connected successfully.');
      } else {
        this.error.set(`Google Drive connection failed: ${gdriveState}.`);
      }
      currentUrl.searchParams.delete('gdrive');
      window.history.replaceState({}, '', currentUrl.toString());
    }
    this.loadSettings();
  }

  loadSettings(): void {
    if (!this.isSuperuser) {
      this.error.set('Only superuser can access cache settings.');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    let pending = 2;
    const complete = () => {
      pending -= 1;
      if (pending <= 0) {
        this.loading.set(false);
      }
    };

    this.api.get<CacheSettingPayload>('/api/v1/settings/cache').subscribe({
      next: (response: ApiResponse<CacheSettingPayload>) => {
        this.cacheEnabled.set(Boolean(response.data?.enabled));
        complete();
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Unable to load settings.');
        complete();
      },
    });

    this.api.get<StorageSettingPayload>('/api/v1/settings/storage').subscribe({
      next: (response: ApiResponse<StorageSettingPayload>) => {
        const data = response.data;
        this.storageProvider.set((data?.provider || 'local') as 'local' | 'do_spaces' | 'google_drive');
        this.expenseAttachmentProvider.set(
          (data?.uploadTargets?.expenseAttachment || data?.provider || 'local') as
            | 'local'
            | 'do_spaces'
            | 'google_drive'
        );
        this.profileImageProvider.set(
          (data?.uploadTargets?.profileImage || data?.provider || 'local') as
            | 'local'
            | 'do_spaces'
            | 'google_drive'
        );
        this.doSpacesEndpoint.set(String(data?.doSpaces?.endpoint || ''));
        this.doSpacesRegion.set(String(data?.doSpaces?.region || ''));
        this.doSpacesBucket.set(String(data?.doSpaces?.bucket || ''));
        this.doSpacesAccessKey.set(String(data?.doSpaces?.accessKey || ''));
        this.doSpacesSecretKey.set('');
        this.doSpacesHasSecretKey.set(Boolean(data?.doSpaces?.hasSecretKey));
        this.doSpacesCdnBaseUrl.set(String(data?.doSpaces?.cdnBaseUrl || ''));
        this.doSpacesDirectory.set(String(data?.doSpaces?.directory || ''));
        this.doSpacesConfigured.set(Boolean(data?.isDoSpacesConfigured));

        this.googleDriveClientId.set(String(data?.googleDrive?.clientId || ''));
        this.googleDriveClientSecret.set('');
        this.googleDriveHasClientSecret.set(Boolean(data?.googleDrive?.hasClientSecret));
        this.googleDriveRedirectUri.set(String(data?.googleDrive?.redirectUri || ''));
        this.googleDriveFolderId.set(String(data?.googleDrive?.folderId || ''));
        this.googleDriveAccountEmail.set(String(data?.googleDrive?.accountEmail || ''));
        this.googleDriveConnected.set(Boolean(data?.isGoogleDriveConfigured));

        complete();
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Unable to load storage settings.');
        complete();
      },
    });
  }

  async save(): Promise<void> {
    if (!this.isSuperuser) {
      this.error.set('Only superuser can update cache settings.');
      return;
    }
    const confirmed = await this.confirmDialog.confirm({
      title: 'Update Settings',
      message: 'Save platform settings changes?',
      confirmText: 'Save Settings',
      confirmButtonClass: 'ui-btn-primary',
      iconClass: 'bi-gear',
    });
    if (!confirmed) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.message.set('');

    let pending = 2;
    const complete = () => {
      pending -= 1;
      if (pending <= 0) {
        this.submitting.set(false);
      }
    };

    this.api
      .put<CacheSettingPayload>('/api/v1/settings/cache', {
        enabled: this.cacheEnabled(),
      })
      .subscribe({
        next: () => {
          complete();
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Unable to update cache setting.');
          complete();
        },
      });

    this.api
      .put<StorageSettingPayload>('/api/v1/settings/storage', {
        provider: this.storageProvider(),
        uploadTargets: {
          expenseAttachment: this.expenseAttachmentProvider(),
          profileImage: this.profileImageProvider(),
        },
        doSpaces: {
          endpoint: this.doSpacesEndpoint().trim(),
          region: this.doSpacesRegion().trim(),
          bucket: this.doSpacesBucket().trim(),
          accessKey: this.doSpacesAccessKey().trim(),
          secretKey: this.doSpacesSecretKey().trim(),
          cdnBaseUrl: this.doSpacesCdnBaseUrl().trim(),
          directory: this.doSpacesDirectory().trim(),
        },
        googleDrive: {
          clientId: this.googleDriveClientId().trim(),
          clientSecret: this.googleDriveClientSecret().trim(),
          redirectUri: this.googleDriveRedirectUri().trim(),
          folderId: this.googleDriveFolderId().trim(),
        },
      })
      .subscribe({
        next: (response) => {
          this.doSpacesHasSecretKey.set(Boolean(response.data?.doSpaces?.hasSecretKey));
          this.doSpacesConfigured.set(Boolean(response.data?.isDoSpacesConfigured));
          this.doSpacesSecretKey.set('');

          this.googleDriveHasClientSecret.set(Boolean(response.data?.googleDrive?.hasClientSecret));
          this.googleDriveConnected.set(Boolean(response.data?.isGoogleDriveConfigured));
          this.googleDriveClientSecret.set('');
          this.googleDriveRedirectUri.set(String(response.data?.googleDrive?.redirectUri || ''));
          this.googleDriveAccountEmail.set(String(response.data?.googleDrive?.accountEmail || ''));

          this.message.set(response.message || 'Settings updated successfully.');
          complete();
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Unable to update storage settings.');
          complete();
        },
      });
  }

  connectGoogleDrive(): void {
    this.error.set('');
    this.message.set('');
    this.api
      .get<{ url: string }>('/api/v1/settings/storage/google-drive/auth-url?returnPath=/settings')
      .subscribe({
        next: (response) => {
          const url = String(response.data?.url || '').trim();
          if (!url) {
            this.error.set('Unable to start Google Drive OAuth flow.');
            return;
          }
          window.location.href = url;
        },
        error: (err) => {
          this.error.set(err?.error?.message || 'Unable to generate Google Drive auth URL.');
        },
      });
  }

  disconnectGoogleDrive(): void {
    this.error.set('');
    this.message.set('');
    this.api.create<StorageSettingPayload>('/api/v1/settings/storage/google-drive/disconnect', {}).subscribe({
      next: () => {
        this.message.set('Google Drive disconnected successfully.');
        this.googleDriveConnected.set(false);
        this.googleDriveAccountEmail.set('');
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'Unable to disconnect Google Drive.');
      },
    });
  }
}
