import {Component, Input} from '@angular/core';
import {DropdownDirective} from './dropdown.directive';

@Component({
  selector: 'app-row-actions',
  standalone: true,
  imports: [DropdownDirective],
  template: `
    <div class="table-actions-menu row-actions-menu">
      <button appDropdown type="button" class="ui-btn ui-btn-sm ui-btn-outline-secondary ui-dropdown-toggle"
        [attr.aria-label]="label" aria-haspopup="true" aria-expanded="false">
        <i class="bi bi-three-dots" aria-hidden="true"></i><span class="sr-only">{{ label }}</span>
      </button>
      <div class="ui-dropdown-menu shadow-panel"><ng-content /></div>
    </div>
  `,
})
export class RowActionsComponent {
  @Input() label = 'Row actions';
}
