import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { CAPACITY_FIELDS } from './pricing-capacity';

@Component({
  selector: 'app-pricing-capacity-fields', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TooltipDirective],
  template: `<div class="capacity-fields" [formGroup]="group">
    <div *ngFor="let field of fields">
      <label class="ui-form-label" [for]="prefix + field.key">{{ field.label }}</label>
      <div class="relative">
        <input class="ui-form-control pr-10" [class.is-invalid]="invalid(field.key)" type="number"
          [id]="prefix + field.key" [formControlName]="field.key" [min]="field.minimum" [max]="field.maximum" [step]="field.step" required
          [attr.aria-invalid]="invalid(field.key)" [attr.aria-describedby]="prefix + field.key + '-help' + (invalid(field.key) ? ' ' + prefix + field.key + '-error' : '')" />
        <span *ngIf="invalid(field.key)" appTooltip tabindex="0" class="field-validation-icon" [title]="error(field.key)" aria-label="Show quantity error"><i class="bi bi-exclamation-circle-fill text-danger" aria-hidden="true"></i></span>
      </div>
      <p class="ui-form-text" [id]="prefix + field.key + '-help'">{{ field.help }}</p>
      <span *ngIf="invalid(field.key)" class="sr-only" [id]="prefix + field.key + '-error'">{{ error(field.key) }}</span>
    </div>
  </div>`,
  styles: ['.capacity-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.25rem; } @media(max-width:450px) { .capacity-fields { grid-template-columns:1fr; } }'],
})
export class PricingCapacityFieldsComponent {
  @Input({ required: true }) group!: FormGroup;
  @Input() prefix = 'estimate-';
  readonly fields = CAPACITY_FIELDS;
  invalid(key: string) { const control = this.group.get(key); return !!control?.touched && control.invalid; }
  error(key: string) { const field = this.fields.find(f => f.key === key)!; return `Enter ${key === 'storageGB' ? 'a finite number' : 'a whole number'} from ${field.minimum} to ${field.maximum.toLocaleString('en-PH')}.`; }
}
