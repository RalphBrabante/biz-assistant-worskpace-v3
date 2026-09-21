import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ConfirmDialogService } from '../../core/confirm-dialog.service';

interface Migration {
  id: string;
  status: 'ready' | 'running' | 'needs_attention' | 'completed' | 'cancelled';
  bucket: string;
  switchedAt: string | null;
  otherExternalLinks: number;
  counts: { total: number; pending: number; completed: number; failed: number; skipped: number; expenses: number; profiles: number };
  issues: { id: string; entityType: string; entityId: string; error: string }[];
}

@Component({
  selector: 'app-storage-migration',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './storage-migration.component.html',
})
export class StorageMigrationComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly endpoint = '/api/v1/settings/storage/migrations';
  private stopped = false;
  private destroyed = false;
  @Output() storageChanged = new EventEmitter<void>();
  readonly job = signal<Migration | null>(null);
  readonly busy = signal(false);
  readonly running = signal(false);
  readonly pausing = signal(false);
  readonly error = signal('');

  get active(): boolean { return ['ready', 'running', 'needs_attention'].includes(this.job()?.status || ''); }
  get progress(): number {
    const counts = this.job()?.counts;
    return counts?.total ? Math.round(((counts.completed + counts.skipped) / counts.total) * 100) : 0;
  }
  get statusLabel(): string {
    if (this.running()) return this.pausing() ? 'Pausing after current record' : 'Copying files';
    return ({ ready: 'Ready to migrate', running: 'Paused · ready to resume', needs_attention: 'Some files need attention',
      completed: 'Migration complete', cancelled: 'Migration closed' } as Record<string, string>)[this.job()?.status || ''] || '';
  }
  ngOnInit(): void { void this.load(); }
  ngOnDestroy(): void { this.destroyed = true; this.stopped = true; }
  private report(error: any): void {
    this.error.set(error?.error?.message || 'The request could not finish. Reload the status before resuming; saved progress is retained.');
  }
  async load(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.job.set((await firstValueFrom(this.api.getFresh<Migration | null>(`${this.endpoint}/latest`))).data || null); }
    catch (error) { this.report(error); }
    finally { this.busy.set(false); }
  }
  async scan(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.job.set((await firstValueFrom(this.api.create<Migration>(this.endpoint, {}))).data || null); }
    catch (error) { this.report(error); }
    finally { this.busy.set(false); }
  }
  async run(retry = false): Promise<void> {
    const job = this.job();
    if (!job || this.busy() || this.running()) return;
    if (!job.switchedAt && !await this.confirm.confirm({ title: 'Move files to local storage?',
      message: `This will use this server for all new uploads and migrate ${job.counts.total} linked records across all organizations. Existing Spaces files will be kept. Ensure the server uses a persistent, backed-up upload folder.`,
      confirmText: 'Use local storage & migrate', confirmButtonClass: 'ui-btn-primary', iconClass: 'bi-hdd' })) return;
    this.running.set(true); this.stopped = false; this.pausing.set(false); this.error.set('');
    try {
      if (retry) this.job.set((await firstValueFrom(this.api.create<Migration>(`${this.endpoint}/${job.id}/retry`, {}))).data!);
      while (!this.stopped && !this.destroyed) {
        const previousSwitch = this.job()?.switchedAt;
        const response = await firstValueFrom(this.api.create<Migration>(`${this.endpoint}/${job.id}/batch`, {}));
        if (this.destroyed) break;
        this.job.set(response.data!);
        if (!previousSwitch && response.data?.switchedAt) this.storageChanged.emit();
        if (['completed', 'needs_attention', 'cancelled'].includes(response.data?.status || '')) break;
      }
    } catch (error) { if (!this.destroyed) { this.report(error); this.storageChanged.emit(); } }
    finally { this.running.set(false); this.pausing.set(false); }
  }
  pause(): void { this.stopped = true; this.pausing.set(true); }
  async close(): Promise<void> {
    const job = this.job();
    if (!job || !await this.confirm.confirm({ title: 'Close this migration?',
      message: 'Copied files and updated links will stay in place. This does not undo the migration or restore the previous upload provider. You can scan remaining Spaces links again later.',
      confirmText: 'Close migration' })) return;
    this.busy.set(true); this.error.set('');
    try { this.job.set((await firstValueFrom(this.api.create<Migration>(`${this.endpoint}/${job.id}/cancel`, {}))).data!); }
    catch (error) { this.report(error); }
    finally { this.busy.set(false); }
  }
  async downloadAudit(): Promise<void> {
    const job = this.job();
    if (!job) return;
    this.busy.set(true); this.error.set('');
    try {
      const response = await firstValueFrom(this.api.getFresh<unknown>(`${this.endpoint}/${job.id}/audit`));
      const url = URL.createObjectURL(new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `storage-migration-${job.id}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { this.report(error); }
    finally { this.busy.set(false); }
  }
}
