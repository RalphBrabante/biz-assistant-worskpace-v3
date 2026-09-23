import { CommonModule } from '@angular/common';
import { Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { countryOptionsFor } from './countries';

@Component({
  selector: 'app-country-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => CountrySelectComponent),
    multi: true,
  }],
  host: { style: 'display: block' },
  template: `
    <select class="ui-form-select" aria-label="Country" autocomplete="country-name"
      [id]="inputId" [ngModel]="value" [ngModelOptions]="{ standalone: true }"
      [disabled]="disabled" [required]="required"
      [class.is-invalid]="invalid" [attr.aria-invalid]="invalid || null"
      (ngModelChange)="selectCountry($event)" (blur)="onTouched()">
      <option value="">Select country</option>
      <option *ngFor="let country of options" [value]="country">{{ country }}</option>
    </select>
  `,
})
export class CountrySelectComponent implements ControlValueAccessor {
  @Input() required = false;
  @Input() invalid = false;
  @Input() inputId = '';
  value = '';
  disabled = false;
  options = countryOptionsFor('');
  onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(value: unknown): void {
    this.value = String(value ?? '').trim();
    this.options = countryOptionsFor(this.value);
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled = disabled; }

  selectCountry(value: string): void {
    this.value = value;
    this.onChange(this.value);
  }
}
