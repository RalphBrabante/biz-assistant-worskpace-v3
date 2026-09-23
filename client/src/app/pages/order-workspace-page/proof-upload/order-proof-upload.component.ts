import { CommonModule } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../core/api.service';
export interface ProofUploadState { id: string; status: 'queued' | 'uploading' | 'processing' | 'uploaded' | 'error'; }
interface Upload extends ProofUploadState { file: File; progress: number | null; error: string; retryable: boolean; subscription?: Subscription; }
@Component({ selector: 'app-order-proof-upload', standalone: true, imports: [CommonModule], templateUrl: './order-proof-upload.component.html', styleUrl: './order-proof-upload.component.scss' })
export class OrderProofUploadComponent implements OnChanges, OnDestroy {
  private readonly api = inject(ApiService);
  @Input({ required: true }) organizationId = '';
  @Input() orderId: string | null = null;
  @Input() disabled = false;
  @Output() uploadsChange = new EventEmitter<ProofUploadState[]>();
  uploads: Upload[] = [];
  dragging = false;
  notice = '';
  private generation = 0;
  private dragDepth = 0;
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['organizationId'] || changes['orderId']) this.clear(true);
  }
  ngOnDestroy(): void { this.clear(true, false); }
  markSaved(): void { this.clear(false); }
  discardAll(): void { this.clear(true); }
  private clear(discard: boolean, emit = true): void {
    this.generation++;
    for (const entry of this.uploads) { entry.subscription?.unsubscribe(); if (discard && entry.retryable) this.discard(entry.id); }
    this.uploads = []; this.notice = ''; this.dragging = false; this.dragDepth = 0;
    if (emit) this.emit();
  }
  private discard(id: string): void { this.api.remove('/api/v1/orders/document-uploads', id).subscribe({ error: () => {} }); }
  private emit(): void { this.uploadsChange.emit(this.uploads.map(({ id, status }) => ({ id, status }))); }
  select(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files || [])); input.value = '';
  }
  dragEnter(event: DragEvent): void { event.preventDefault(); if (!this.disabled) { this.dragDepth++; this.dragging = true; } }
  dragOver(event: DragEvent): void { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = this.disabled ? 'none' : 'copy'; }
  dragLeave(event: DragEvent): void { event.preventDefault(); this.dragDepth = Math.max(0, this.dragDepth - 1); this.dragging = this.dragDepth > 0; }
  drop(event: DragEvent): void {
    event.preventDefault(); event.stopPropagation(); this.dragDepth = 0; this.dragging = false;
    this.addFiles(Array.from(event.dataTransfer?.files || []));
  }
  addFiles(files: File[]): void {
    if (this.disabled || !this.organizationId) return;
    this.notice = '';
    for (const file of files) {
      if (this.uploads.length >= 10) { this.notice = 'Add up to 10 files at a time. Save this draft before adding more.'; break; }
      if (this.uploads.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) { this.notice = `${file.name} is already in the upload list.`; continue; }
      const error = !file.size || file.size > 5 * 1024 * 1024 ? 'Choose a nonempty file up to 5 MB.' : !/\.(pdf|png|jpe?g)$/i.test(file.name) ? 'Only PDF, PNG, and JPEG files are supported.' : '';
      this.uploads.push({ id: crypto.randomUUID(), file, status: error ? 'error' : 'queued', progress: 0, error, retryable: !error });
    }
    this.emit(); this.pump();
  }
  retry(entry: Upload): void {
    if (this.disabled || entry.status !== 'error' || !entry.retryable) return;
    entry.status = 'queued'; entry.progress = 0; entry.error = ''; this.emit(); this.pump();
  }
  remove(entry: Upload): void {
    if (this.disabled) return;
    entry.subscription?.unsubscribe();
    this.uploads = this.uploads.filter(value => value !== entry);
    if (entry.retryable) this.discard(entry.id);
    this.emit(); this.pump();
  }
  private pump(): void {
    while (this.uploads.filter(entry => ['uploading', 'processing'].includes(entry.status)).length < 2) {
      const entry = this.uploads.find(value => value.status === 'queued');
      if (!entry) break;
      this.start(entry);
    }
  }
  private start(entry: Upload): void {
    const generation = this.generation;
    const current = () => generation === this.generation && this.uploads.includes(entry);
    const form = new FormData(); form.append('document', entry.file); form.append('organizationId', this.organizationId); form.append('uploadId', entry.id);
    if (this.orderId) form.append('orderId', this.orderId);
    entry.status = 'uploading'; entry.progress = 0; this.emit();
    entry.subscription = this.api.uploadFormData<{ id: string }>('/api/v1/orders/document-uploads', form).subscribe({
      next: event => {
        if (!current()) return;
        if (event.type === HttpEventType.UploadProgress) {
          entry.progress = event.total ? Math.min(99, Math.floor(100 * event.loaded / event.total)) : null;
          if (event.total && event.loaded >= event.total) entry.status = 'processing';
        } else if (event.type === HttpEventType.Response) {
          if (event.body?.data?.id !== entry.id) { this.failed(entry, 'The upload could not be confirmed. Retry this file.'); return; }
          entry.status = 'uploaded'; entry.progress = 100; this.emit(); this.pump();
        }
      },
      error: error => { if (current()) this.failed(entry, error?.error?.message || 'Upload failed. Check your connection and retry.'); },
      complete: () => { if (current() && ['uploading', 'processing'].includes(entry.status)) this.failed(entry, 'The upload did not finish. Retry this file.'); },
    });
  }
  private failed(entry: Upload, message: string): void { entry.status = 'error'; entry.error = message; this.emit(); this.pump(); }
  trackUpload(_index: number, entry: Upload): string { return entry.id; }
  size(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  statusLabel(entry: Upload): string {
    return entry.status === 'uploaded' ? 'Uploaded · ready to save' : entry.status === 'processing' ? 'Finalizing upload…' : entry.status === 'uploading' ? entry.progress === null ? 'Uploading…' : `Uploading ${entry.progress}%` : entry.status === 'queued' ? 'Waiting to upload' : 'Upload failed';
  }
}
