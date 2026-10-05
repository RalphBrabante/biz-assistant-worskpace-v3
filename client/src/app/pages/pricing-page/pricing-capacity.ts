import { AbstractControl, FormControl, FormGroup, Validators } from '@angular/forms';
import { CAPACITY_BOUNDS, Capacity } from '../../../../../api/src/modules/pricing/pricing-domain';

export const CAPACITY_FIELDS: { key: keyof Capacity; label: string; minimum: number; maximum: number; step: string; help: string }[] = [
  { key: 'organizations', label: 'Active organizations', minimum: 1, maximum: CAPACITY_BOUNDS.organizations, step: '1', help: 'Operating businesses or clients; contacts do not count.' },
  { key: 'users', label: 'Full-access users', minimum: 1, maximum: CAPACITY_BOUNDS.users, step: '1', help: 'Include the owner. Count each person once in this workspace.' },
  { key: 'storageGB', label: 'Hosted storage (GB)', minimum: 0, maximum: CAPACITY_BOUNDS.storageGB, step: 'any', help: 'Pooled app-hosted storage. 1 GB = 1,000,000,000 bytes.' },
  { key: 'mailboxes', label: 'Connected mailboxes', minimum: 0, maximum: CAPACITY_BOUNDS.mailboxes, step: '1', help: 'Pooled integrations; provider subscriptions are separate.' },
];
export function createCapacityForm(value: Capacity) {
  const controls = Object.fromEntries(CAPACITY_FIELDS.map(field => [field.key,
    new FormControl<number | null>(value[field.key], [Validators.required, Validators.min(field.minimum), Validators.max(field.maximum),
      (control: AbstractControl) => typeof control.value === 'number' && Number.isFinite(control.value)
        && (field.key === 'storageGB' || Number.isInteger(control.value)) ? null : { quantity: true }])
  ])) as { [K in keyof Capacity]: FormControl<number | null> };
  return new FormGroup(controls);
}
