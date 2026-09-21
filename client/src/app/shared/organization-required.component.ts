import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrganizationContextService } from '../core/organization-context.service';

@Component({
  selector: 'app-organization-required',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ui-alert ui-alert-info flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="font-semibold"><i class="bi bi-buildings mr-2" aria-hidden="true"></i>Select an organization to continue</div>
        <div class="text-xs mt-1">This page needs a specific organization to show and manage its data.</div>
      </div>
      <button *ngIf="context.isSuperuser()" type="button" class="ui-btn ui-btn-primary" (click)="context.requestSelection(true)">
        Select organization
      </button>
      <span *ngIf="!context.isSuperuser()" class="text-xs">Contact your administrator to assign an organization.</span>
    </div>
  `,
})
export class OrganizationRequiredComponent {
  readonly context = inject(OrganizationContextService);
}
