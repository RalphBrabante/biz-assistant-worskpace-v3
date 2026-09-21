import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TooltipDirective } from '../../../shared/tooltip.directive';

interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
}

@Component({
  selector: 'app-vendor-form-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TooltipDirective],
  templateUrl: './vendor-form-fields.component.html',
})
export class VendorFormFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() submitted = false;
  @Input() countryOptions: string[] = [];
  @Input() organizationOptions: OrganizationOption[] = [];
  @Input() showOrganizationAssignments = false;
  @Input() ownerOrganizationId = '';

  @Output() taxIdInput = new EventEmitter<Event>();

  private getControl(name: string): AbstractControl | null {
    return this.form?.get(name) || null;
  }

  isFieldRequired(name: string): boolean {
    return Boolean(this.getControl(name)?.hasValidator(Validators.required));
  }

  shouldShowError(name: string): boolean {
    const control = this.getControl(name);
    return Boolean(control?.invalid && (control.touched || control.dirty || this.submitted));
  }

  fieldError(name: string): string {
    const control = this.getControl(name);
    if (!control || !this.shouldShowError(name)) {
      return '';
    }
    if (control.hasError('required')) {
      if (name === 'name') return 'Name is required.';
      if (name === 'category') return 'Category is required.';
      if (name === 'status') return 'Status is required.';
      return 'This field is required.';
    }
    if (control.hasError('email')) {
      return 'Enter a valid email address.';
    }
    if (control.hasError('maxlength')) {
      return 'Value is too long.';
    }
    return 'Invalid value.';
  }

  organizationLabel(organization: OrganizationOption): string {
    return organization.name || organization.legalName || organization.id;
  }
}
