/** Pure, shared pricing domain. Money is always integer PHP centavos. */
export type BillingCycle = 'monthly' | 'annual';
export type PlanId = 'bronze' | 'silver' | 'gold';
export type AddonId = 'extra_user' | 'extra_organization' | 'storage_10gb' | 'extra_mailbox';
export type Availability = 'available' | 'planned' | 'unverified';
export interface Capacity { organizations: number; users: number; storageGB: number; mailboxes: number; }
export interface Plan {
  id: PlanId; name: string; descriptor: string; description: string; badge?: string;
  monthlyAmountMinor: number; annualAmountMinor: number;
  includedOrganizations: number; includedUsers: number; includedStorageGB: number; includedMailboxes: number;
  includedFeatureIds: string[];
}
export interface Addon { id: AddonId; name: string; unit: string; monthlyAmountMinor: number; annualAmountMinor: number; eligiblePlanIds: PlanId[]; }
export interface Feature { id: string; label: string; group: string; availability: Availability; detail?: string; }
export interface PricingCatalogue {
  version: string; currency: 'PHP'; launchMode: 'preview' | 'live'; ctaMode: 'request' | 'checkout';
  taxDisplayMode: 'unconfirmed' | 'inclusive' | 'exclusive'; trialEnabled: boolean;
  plans: Plan[]; addons: Addon[]; features: Feature[];
}
const includedFeatureIds = ['sales', 'expenses', 'contacts', 'quarterly', 'worksheets', 'access', 'tickets'];
export const PRICING_CATALOGUE: PricingCatalogue = {
  version: '2026-10-launch-proposal-v1', currency: 'PHP',
  launchMode: 'preview', ctaMode: 'request', taxDisplayMode: 'unconfirmed', trialEnabled: false,
  plans: [
    { id: 'bronze', name: 'Bronze', descriptor: 'Starter', description: 'For one business or an accountant getting started.', monthlyAmountMinor: 149900, annualAmountMinor: 1499000, includedOrganizations: 1, includedUsers: 2, includedStorageGB: 5, includedMailboxes: 1, includedFeatureIds: [...includedFeatureIds] },
    { id: 'silver', name: 'Silver', descriptor: 'Practice', description: 'For a growing accounting practice managing several clients.', badge: 'Recommended for growing practices', monthlyAmountMinor: 399900, annualAmountMinor: 3999000, includedOrganizations: 5, includedUsers: 5, includedStorageGB: 25, includedMailboxes: 3, includedFeatureIds: [...includedFeatureIds] },
    { id: 'gold', name: 'Gold', descriptor: 'Firm', description: 'For established teams managing a larger client portfolio.', monthlyAmountMinor: 899900, annualAmountMinor: 8999000, includedOrganizations: 20, includedUsers: 15, includedStorageGB: 100, includedMailboxes: 10, includedFeatureIds: [...includedFeatureIds] },
  ],
  addons: [
    { id: 'extra_user', name: 'Extra user', unit: '1 additional full-access user', monthlyAmountMinor: 19900, annualAmountMinor: 199000, eligiblePlanIds: ['bronze', 'silver', 'gold'] },
    { id: 'extra_organization', name: 'Extra organization', unit: '1 additional operating or client organization', monthlyAmountMinor: 49900, annualAmountMinor: 499000, eligiblePlanIds: ['bronze', 'silver', 'gold'] },
    { id: 'storage_10gb', name: 'More hosted storage', unit: '10 GB of additional hosted storage', monthlyAmountMinor: 14900, annualAmountMinor: 149000, eligiblePlanIds: ['bronze', 'silver', 'gold'] },
    { id: 'extra_mailbox', name: 'Extra mailbox', unit: '1 additional connected mailbox', monthlyAmountMinor: 14900, annualAmountMinor: 149000, eligiblePlanIds: ['bronze', 'silver', 'gold'] },
  ],
  features: [
    { id: 'sales', label: 'Sales orders and invoices', group: 'Business operations', availability: 'available' },
    { id: 'expenses', label: 'Expenses and attachments', group: 'Business operations', availability: 'available' },
    { id: 'contacts', label: 'Customer and vendor records', group: 'Business operations', availability: 'available' },
    { id: 'quarterly', label: 'Quarterly sales and expense reports', group: 'Philippine tax preparation', availability: 'available' },
    { id: 'worksheets', label: 'BIR preparation worksheets and exports', group: 'Philippine tax preparation', availability: 'available', detail: 'Source data and organization tax settings determine applicable outputs. Review is required before official filing.' },
    { id: 'access', label: 'Organization-scoped roles and access', group: 'Collaboration', availability: 'available' },
    { id: 'tickets', label: 'Email tickets and connected mailboxes', group: 'Collaboration', availability: 'available', detail: 'Provider subscriptions are separate.' },
    { id: 'support', label: 'Support service levels', group: 'Support', availability: 'unverified', detail: 'Service levels and response times will be confirmed before purchase.' },
  ],
};
// No configuration switch can enable purchasing without verified infrastructure.
export function assertPreviewPublication(catalogue: PricingCatalogue): void {
  if (catalogue.launchMode !== 'preview' || catalogue.ctaMode !== 'request'
    || catalogue.taxDisplayMode !== 'unconfirmed' || catalogue.trialEnabled !== false) {
    throw new Error('Live purchasing and trials are unavailable until billing infrastructure and tax treatment are verified.');
  }
}
export const CAPACITY_BOUNDS = { organizations: 10000, users: 10000, storageGB: 1000000, mailboxes: 10000 };
export function capacityErrors(value: Capacity): Partial<Record<keyof Capacity, string>> {
  const errors: Partial<Record<keyof Capacity, string>> = {};
  for (const key of Object.keys(CAPACITY_BOUNDS) as (keyof Capacity)[]) {
    const minimum = key === 'organizations' || key === 'users' ? 1 : 0;
    const number = value?.[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum
      || number > CAPACITY_BOUNDS[key] || (key !== 'storageGB' && !Number.isInteger(number))) {
      errors[key] = `${key === 'storageGB' ? 'Storage' : key[0].toUpperCase() + key.slice(1)} must be ${key === 'storageGB' ? 'a finite number' : 'a whole number'} from ${minimum} to ${CAPACITY_BOUNDS[key].toLocaleString('en-PH')}.`;
    }
  }
  return errors;
}
export interface EstimateLine { id: AddonId; name: string; unit: string; quantity: number; unitAmountMinor: number; amountMinor: number; }
export interface Estimate { planId: PlanId; cycle: BillingCycle; baseAmountMinor: number; lines: EstimateLine[]; subtotalMinor: number; eligible: boolean; largeConfiguration: boolean; }
export function planCapacity(plan: Plan): Capacity {
  return { organizations: plan.includedOrganizations, users: plan.includedUsers, storageGB: plan.includedStorageGB, mailboxes: plan.includedMailboxes };
}
export function estimatePlan(catalogue: PricingCatalogue, planId: PlanId, desired: Capacity, cycle: BillingCycle, requiredFeatureIds: string[] = []): Estimate {
  if (Object.keys(capacityErrors(desired)).length || !['monthly', 'annual'].includes(cycle)) throw new Error('Invalid capacity or billing cycle.');
  const plan = catalogue.plans.find(p => p.id === planId);
  if (!plan) throw new Error('Unknown plan.');
  const quantities: Record<AddonId, number> = {
    extra_user: Math.max(0, desired.users - plan.includedUsers),
    extra_organization: Math.max(0, desired.organizations - plan.includedOrganizations),
    storage_10gb: Math.ceil(Math.max(0, desired.storageGB - plan.includedStorageGB) / 10),
    extra_mailbox: Math.max(0, desired.mailboxes - plan.includedMailboxes),
  };
  const baseAmountMinor = cycle === 'monthly' ? plan.monthlyAmountMinor : plan.annualAmountMinor;
  const lines = catalogue.addons.map(addon => {
    const unitAmountMinor = cycle === 'monthly' ? addon.monthlyAmountMinor : addon.annualAmountMinor;
    return { id: addon.id, name: addon.name, unit: addon.unit, quantity: quantities[addon.id], unitAmountMinor, amountMinor: quantities[addon.id] * unitAmountMinor };
  });
  const eligible = requiredFeatureIds.every(id => plan.includedFeatureIds.includes(id) && catalogue.features.some(f => f.id === id && f.availability === 'available'))
    && catalogue.addons.every(a => !quantities[a.id] || a.eligiblePlanIds.includes(plan.id));
  const subtotalMinor = baseAmountMinor + lines.reduce((sum, line) => sum + line.amountMinor, 0);
  if (!Number.isSafeInteger(subtotalMinor)) throw new Error('Estimate exceeds supported amount.');
  return { planId, cycle, baseAmountMinor, lines, subtotalMinor, eligible, largeConfiguration: desired.organizations > 50 || desired.users > 50 };
}
export function recommendPlan(catalogue: PricingCatalogue, desired: Capacity, cycle: BillingCycle, requiredFeatureIds: string[] = []): Estimate | null {
  return catalogue.plans.map(plan => estimatePlan(catalogue, plan.id, desired, cycle, requiredFeatureIds))
    .filter(estimate => estimate.eligible).sort((a, b) => a.subtotalMinor - b.subtotalMinor)[0] || null;
}
