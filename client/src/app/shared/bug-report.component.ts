import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { OrganizationContextService } from '../core/organization-context.service';
import { ModalDirective } from './modal.directive';

@Component({
  selector: 'app-bug-report', standalone: true,
  imports: [CommonModule, FormsModule, ModalDirective],
  templateUrl: './bug-report.component.html',
})
export class BugReportComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly organizations = inject(OrganizationContextService);
  private submission?: Subscription;
  visible = false;
  submitting = false;
  submitted = false;
  error = '';
  title = '';
  description = '';
  steps = '';
  expectedResult = '';
  pagePath = '';
  private organizationId = '';

  open(): void {
    if (this.visible) return;
    if (this.submitted) {
      this.title = ''; this.description = ''; this.steps = ''; this.expectedResult = '';
    }
    this.submitted = false;
    this.error = '';
    // Never capture query strings, fragments, tokens, or browser storage.
    this.pagePath = this.router.url.split(/[?#]/, 1)[0];
    this.organizationId = this.organizations.getActiveOrganizationId();
    this.visible = true;
  }
  close(): void {
    if (!this.submitting) this.visible = false;
  }
  submit(): void {
    if (this.submitting || this.submitted) return;
    if (!this.title.trim() || !this.description.trim()) {
      this.error = 'Enter a title and describe what went wrong.';
      return;
    }
    this.error = '';
    this.submitting = true;
    this.submission = this.api.create<{id: string}>('/api/v1/bug-reports', {
      title: this.title.trim(), description: this.description.trim(), steps: this.steps.trim(),
      expectedResult: this.expectedResult.trim(), pagePath: this.pagePath, organizationId: this.organizationId || null,
    }).subscribe({
      next: () => { this.submitting = false; this.submitted = true; },
      error: error => {
        this.submitting = false;
        this.error = error?.error?.message || 'Unable to submit your report. Your draft is still here; please try again.';
      },
    });
  }
  ngOnDestroy(): void { this.submission?.unsubscribe(); }
}
