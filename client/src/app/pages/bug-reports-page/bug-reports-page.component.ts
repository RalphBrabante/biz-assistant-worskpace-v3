import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { OrganizationContextService } from '../../core/organization-context.service';
import { ModalDirective } from '../../shared/modal.directive';

interface BugReport {
  id: string;
  organizationId: string | null;
  title: string;
  description: string;
  steps?: string;
  expectedResult?: string;
  pagePath: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  reporter?: {firstName: string; lastName: string};
  reviewer?: {firstName: string; lastName: string};
  organization?: {name: string};
}
interface BoardColumn {
  id: string;
  name: string;
  color: string;
  isSystem: boolean;
  organizationId: string | null;
  organization?: {name: string};
  total: number;
  rows: BugReport[];
  page: number;
  loading: boolean;
  error: string;
  subscription?: Subscription;
}
interface BoardResponse { columns: BoardColumn[]; total: number; canCreateColumn: boolean; }

@Component({
  selector: 'app-bug-reports-page', standalone: true,
  imports: [CommonModule, FormsModule, ModalDirective],
  templateUrl: './bug-reports-page.component.html',
  styleUrl: './bug-reports-page.component.css',
})
export class BugReportsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly organizations = inject(OrganizationContextService);
  private boardSub?: Subscription;
  private updateSub?: Subscription;
  private columnSub?: Subscription;
  columns: BoardColumn[] = [];
  selected: BugReport | null = null;
  selectedStatus = '';
  search = '';
  private appliedSearch = '';
  total = 0;
  loading = false;
  saving = false;
  movingId = '';
  error = '';
  saveError = '';
  notice = '';
  canCreateColumn = false;
  columnModalOpen = false;
  columnName = '';
  columnColor = 'violet';
  creatingColumn = false;
  columnError = '';
  draggedReport: BugReport | null = null;
  dropTargetId = '';
  readonly colors = [
    {value: 'slate', label: 'Slate'}, {value: 'blue', label: 'Blue'}, {value: 'violet', label: 'Violet'},
    {value: 'amber', label: 'Amber'}, {value: 'green', label: 'Green'}, {value: 'rose', label: 'Rose'},
  ];
  get busy(): boolean { return this.loading || this.saving || this.creatingColumn; }
  get allOrganizations(): boolean { return !this.organizations.getActiveOrganizationId(); }
  get availableColumns(): BoardColumn[] {
    return this.selected ? this.columns.filter(column => this.canUseColumn(this.selected!, column)) : [];
  }
  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void {
    this.boardSub?.unsubscribe(); this.updateSub?.unsubscribe(); this.columnSub?.unsubscribe();
    this.columns.forEach(column => column.subscription?.unsubscribe());
  }
  private params(): URLSearchParams {
    const params = new URLSearchParams();
    const organizationId = this.organizations.getActiveOrganizationId();
    if (organizationId) params.set('organizationId', organizationId);
    if (this.appliedSearch) params.set('q', this.appliedSearch);
    return params;
  }
  applySearch(): void {
    if (this.saving || this.creatingColumn) return;
    this.appliedSearch = this.search.trim(); this.load();
  }
  clearSearch(): void { this.search = ''; this.applySearch(); }
  load(): void {
    if (this.saving || this.creatingColumn) return;
    this.boardSub?.unsubscribe();
    this.columns.forEach(column => column.subscription?.unsubscribe());
    this.endDrag(); this.loading = true; this.error = '';
    // Private reports bypass the service worker's shared API cache.
    this.boardSub = this.api.getFresh<BoardResponse>(`/api/v1/bug-reports/board?${this.params()}`).subscribe({
      next: response => {
        this.loading = false;
        if (!response.data) { this.error = 'The board is unavailable. Please try again.'; this.columns = []; return; }
        this.columns = response.data.columns.map(column => ({...column, page: 1, loading: false, error: ''}));
        this.total = response.data.total; this.canCreateColumn = response.data.canCreateColumn;
      },
      error: error => {
        this.loading = false; this.columns = []; this.canCreateColumn = false;
        this.error = error?.error?.message || 'Unable to load the bug report board.';
      },
    });
  }
  loadMore(column: BoardColumn): void {
    if (this.busy || column.loading || column.rows.length >= column.total) return;
    column.loading = true; column.error = '';
    const params = this.params(); params.set('status', column.id); params.set('page', String(column.page + 1));
    column.subscription = this.api.getFresh<BugReport[]>(`/api/v1/bug-reports?${params}`).subscribe({
      next: response => {
        column.loading = false; column.page += 1;
        const existing = new Set(column.rows.map(row => row.id));
        column.rows = [...column.rows, ...(response.data || []).filter(row => !existing.has(row.id))];
        column.total = Number(response.meta?.total || 0);
        if (!response.data?.length && column.rows.length < column.total) this.load();
      },
      error: error => { column.loading = false; column.error = error?.error?.message || 'Unable to load more reports.'; },
    });
  }
  statusLabel(value: string): string { return this.columns.find(column => column.id === value)?.name || value; }
  reporterName(report: BugReport): string { return report.reporter ? `${report.reporter.firstName} ${report.reporter.lastName}` : 'Deleted user'; }
  reportKey(report: BugReport): string { return `BUG-${report.id.slice(0, 8).toUpperCase()}`; }
  trackColumn(_index: number, column: BoardColumn): string { return column.id; }
  trackReport(_index: number, report: BugReport): string { return report.id; }
  canUseColumn(report: BugReport, column: BoardColumn): boolean {
    return column.isSystem || column.organizationId === report.organizationId;
  }
  open(report: BugReport): void {
    if (this.busy || this.draggedReport) return;
    this.selected = report; this.selectedStatus = report.status; this.saveError = ''; this.notice = '';
  }
  close(): void { if (!this.saving) this.selected = null; }
  save(): void {
    const column = this.columns.find(row => row.id === this.selectedStatus);
    if (this.selected && column) this.moveReport(this.selected, column);
  }
  startDrag(event: DragEvent, report: BugReport): void {
    if (this.busy) { event.preventDefault(); return; }
    this.draggedReport = report;
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', report.id); }
  }
  dragOver(event: DragEvent, column: BoardColumn): void {
    if (!this.draggedReport || this.busy || this.draggedReport.status === column.id || !this.canUseColumn(this.draggedReport, column)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropTargetId = column.id;
  }
  dragLeave(event: DragEvent, column: BoardColumn): void {
    const target = event.currentTarget as HTMLElement;
    if (!event.relatedTarget || !target.contains(event.relatedTarget as Node)) {
      if (this.dropTargetId === column.id) this.dropTargetId = '';
    }
  }
  drop(event: DragEvent, column: BoardColumn): void {
    event.preventDefault();
    const report = this.draggedReport;
    this.endDrag();
    if (report) this.moveReport(report, column);
  }
  endDrag(): void { this.draggedReport = null; this.dropTargetId = ''; }
  moveReport(report: BugReport, column: BoardColumn): void {
    if (this.busy || report.status === column.id || !this.canUseColumn(report, column)) return;
    const source = this.columns.find(row => row.id === report.status);
    if (!source) return;
    this.columns.forEach(row => row.subscription?.unsubscribe());
    const snapshot = this.columns.map(row => ({column: row, rows: [...row.rows], total: row.total}));
    const previousStatus = report.status;
    source.rows = source.rows.filter(row => row.id !== report.id); source.total -= 1;
    column.rows = [{...report, status: column.id}, ...column.rows]; column.total += 1;
    this.saving = true; this.movingId = report.id; this.error = ''; this.saveError = ''; this.notice = '';
    this.updateSub = this.api.put(`/api/v1/bug-reports/${encodeURIComponent(report.id)}?${this.params()}`, {
      status: column.id, expectedStatus: previousStatus,
    }).subscribe({
      next: () => {
        this.saving = false; this.movingId = ''; this.selected = null;
        this.notice = `${this.reportKey(report)} moved to ${column.name}.`;
        this.load();
      },
      error: error => {
        for (const state of snapshot) { state.column.rows = state.rows; state.column.total = state.total; state.column.loading = false; }
        this.saving = false; this.movingId = '';
        const message = error?.error?.message || 'The move could not be saved. The card has been restored; please try again.';
        if (error?.status === 409) { this.selected = null; this.notice = message; this.load(); }
        else if (this.selected) this.saveError = message;
        else this.error = message;
      },
    });
  }
  openColumnModal(): void {
    if (this.busy || !this.canCreateColumn) return;
    this.columnName = ''; this.columnColor = 'violet'; this.columnError = ''; this.columnModalOpen = true;
  }
  closeColumnModal(): void { if (!this.creatingColumn) this.columnModalOpen = false; }
  createColumn(): void {
    if (this.creatingColumn || !this.canCreateColumn) return;
    const name = this.columnName.trim();
    if (!name || name.length > 60) { this.columnError = 'Enter a column name of up to 60 characters.'; return; }
    this.creatingColumn = true; this.columnError = '';
    this.columnSub = this.api.create(`/api/v1/bug-reports/columns?${this.params()}`, {name, color: this.columnColor}).subscribe({
      next: () => { this.creatingColumn = false; this.columnModalOpen = false; this.notice = `Column “${name}” created.`; this.load(); },
      error: error => { this.creatingColumn = false; this.columnError = error?.error?.message || 'Unable to create the column. Please try again.'; },
    });
  }
}
