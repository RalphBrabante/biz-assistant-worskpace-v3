import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TooltipDirective } from '../../../shared/tooltip.directive';

interface TaxTypeOption {
  id: string;
  code: string;
  name: string;
  percentage: number;
}

interface CurrencyOption {
  code: string;
  label: string;
}

@Component({
  selector: 'app-organization-form-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TooltipDirective],
  templateUrl: './organization-form-fields.component.html',
})
export class OrganizationFormFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() countryOptions: string[] = [];
  @Input() currencyOptions: CurrencyOption[] = [];
  @Input() taxTypes: TaxTypeOption[] = [];
  @Output() taxIdInput = new EventEmitter<Event>();

  private control(name: string): AbstractControl | null {
    return this.form?.get(name) || null;
  }

  isRequired(name: string): boolean {
    return Boolean(this.control(name)?.hasValidator(Validators.required));
  }

  hasError(name: string): boolean {
    const c = this.control(name);
    return Boolean(c?.invalid && (c.touched || c.dirty));
  }

  error(name: string): string {
    const c = this.control(name);
    if (!c || !this.hasError(name)) return '';
    if (c.hasError('required')) return 'This field is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    if (c.hasError('maxlength')) return 'Value is too long.';
    if (c.hasError('min')) return 'Value must be 0 or greater.';
    return 'Invalid value.';
  }
}
