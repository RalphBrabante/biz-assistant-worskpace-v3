import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';

export interface GeneratedReportPdf {
  id: string; organizationId: string; documentCode: string; title: string;
  year: number; quarter: number | null; filename: string; byteLength: number; generatedAt: string;
}
@Component({
  selector: 'app-generated-pdf-archive', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './generated-pdf-archive.component.html', styleUrl: './generated-pdf-archive.component.css',
})
export class GeneratedPdfArchiveComponent implements OnChanges, OnDestroy {
  @Input() organizationId = '';
  @Input() year = new Date().getFullYear();
  @Input() refreshVersion = 0;
  readonly rows = signal<GeneratedReportPdf[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly downloadError = signal('');
  readonly downloading = signal('');
  page = 1; pageSize = 20; total = 0; totalPages = 1;
  private listRequest?: Subscription;
  private downloadRequest?: Subscription;
  private revision = 0;

  constructor(private readonly api: ApiService) {}
  ngOnChanges(): void {
    this.cancelDownload();
    this.page = 1;
    this.load();
  }
  load(): void {
    this.listRequest?.unsubscribe();
    this.rows.set([]); this.error.set(''); this.total = 0; this.totalPages = 1;
    if (!this.organizationId) { this.loading.set(false); return; }
    this.loading.set(true);
    const params = new URLSearchParams({ organizationId: this.organizationId, year: String(this.year), page: String(this.page), limit: String(this.pageSize) });
    this.listRequest = this.api.list<GeneratedReportPdf>(`/api/v1/reports/documents?${params}`).subscribe({
      next: response => {
        this.loading.set(false);
        this.rows.set((response.data || []).filter(row => row.organizationId === this.organizationId && Number(row.year) === Number(this.year)));
        this.total = Number(response.meta?.total || 0); this.totalPages = Math.max(1, Number(response.meta?.totalPages || 1));
      },
      error: error => { this.loading.set(false); this.error.set(error?.error?.message || 'Unable to load generated PDFs. Please try again.'); },
    });
  }
  changePage(page: number): void {
    if (this.loading() || page < 1 || page > this.totalPages || page === this.page) return;
    this.page = page; this.load();
  }
  changePageSize(value: number): void { this.pageSize = Number(value); this.page = 1; this.load(); }
  fileSize(bytes: number): string { return bytes < 1048576 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
  download(row: GeneratedReportPdf): void {
    if (this.downloading() || row.organizationId !== this.organizationId || Number(row.year) !== Number(this.year)) return;
    this.cancelDownload(); this.downloading.set(row.id);
    const revision = this.revision;
    const params = new URLSearchParams({ organizationId: this.organizationId });
    this.downloadRequest = this.api.download(`/api/v1/reports/documents/${encodeURIComponent(row.id)}/pdf?${params}`).subscribe({
      next: blob => {
        if (revision !== this.revision) return;
        this.downloading.set('');
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = row.filename; link.click();
        // Give the browser time to accept the download before releasing its URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: async error => {
        let message = 'Unable to download this PDF. Please try again.';
        if (error?.error instanceof Blob) {
          try { message = JSON.parse(await error.error.text()).message || message; } catch {}
        } else message = error?.error?.message || message;
        if (revision !== this.revision) return;
        this.downloading.set(''); this.downloadError.set(message);
      },
    });
  }
  private cancelDownload(): void {
    this.downloadRequest?.unsubscribe(); this.revision++;
    this.downloading.set(''); this.downloadError.set('');
  }
  ngOnDestroy(): void { this.listRequest?.unsubscribe(); this.cancelDownload(); }
}
