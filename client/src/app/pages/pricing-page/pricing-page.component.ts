import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { ThemeService } from '../../core/theme.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { BillingCycle, Capacity, Estimate, Plan, PlanId, PricingCatalogue, assertPreviewPublication, estimatePlan, planCapacity, recommendPlan } from '../../../../../api/src/modules/pricing/pricing-domain';
import { createCapacityForm } from './pricing-capacity';
import { PricingCapacityFieldsComponent } from './pricing-capacity-fields.component';

interface PublicPricing { catalogue: PricingCatalogue; requestChallenge: string | null; canonicalUrl: string | null; }
@Component({
  selector: 'app-pricing-page', standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, ReactiveFormsModule, TooltipDirective, PricingCapacityFieldsComponent],
  templateUrl: './pricing-page.component.html', styleUrl: './pricing-page.component.css',
})
export class PricingPageComponent implements OnInit, OnDestroy {
  @ViewChild('requestDialog', { static: true }) requestDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('requestDone') set requestDone(button: ElementRef<HTMLButtonElement> | undefined) { button?.nativeElement.focus(); }
  catalogue: PricingCatalogue | null = null;
  loading = true; loadError = ''; cycle: BillingCycle = 'monthly'; selectedPlanId: PlanId | '' = '';
  readonly capacityForm = createCapacityForm({ organizations: 1, users: 2, storageGB: 5, mailboxes: 1 });
  readonly requestCapacityForm = createCapacityForm({ organizations: 1, users: 2, storageGB: 5, mailboxes: 1 });
  readonly contactForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120), Validators.pattern(/\S/)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] }),
    firmName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(160)] }),
    marketingConsent: new FormControl(false, { nonNullable: true }),
  });
  requestPlanId: PlanId = 'bronze'; requestCycle: BillingCycle = 'monthly'; website = '';
  submitting = false; requestError = ''; requestSuccess = ''; refreshingChallenge = false;
  private challenge: string | null = null;
  private requestKey = ''; private requestFingerprint = ''; private previousFocus: HTMLElement | null = null;
  private readonly subscriptions = new Subscription();
  private previousTitle = ''; private previousDescription: string | null = null;
  private canonical: HTMLLinkElement | null = null; private previousCanonical: string | null = null;
  readonly featureGroups = ['Business operations', 'Philippine tax preparation', 'Collaboration', 'Support'];
  readonly faqs = [
    { question: 'What is a billing workspace, and what counts as an organization?', answer: 'A billing workspace is the paying firm or business account. Each organization is a separate operating business or client with isolated records. Customer and vendor contacts are not organizations. A billing-only parent does not use a slot; your own firm’s operating books do if maintained as an organization. These workspace allowances are proposed launch terms.' },
    { question: 'How are full-access users counted?', answer: 'Each accepted, active full-access user, including the owner, counts once within a paying workspace even if assigned to several organizations. The same person can count separately in independently paying workspaces. Users who edit client records occupy seats. Workspace membership does not automatically give access to every organization.' },
    { question: 'Can I add capacity without moving to another plan?', answer: 'The launch proposal offers extra users, organizations, 10 GB storage packs, and connected mailboxes on all three plans. Storage and mailbox allowances are pooled across the proposed billing workspace. Mailbox provider subscriptions are separate; external storage integrations do not mean unlimited app-hosted storage.' },
    { question: 'How does annual billing work?', answer: 'Annual pricing is a proposed upfront payment for twelve months of service, at the cost of ten monthly payments. The annual total is the amount payable. Any monthly equivalent is explanatory and does not offer monthly installments. This preview collects no payment.' },
    { question: 'Are taxes included?', answer: 'Tax treatment will be confirmed before purchase. Estimates show the proposed subscription subtotal; final applicable taxes and payable amounts must be confirmed before any payment.' },
    { question: 'Are planned features included?', answer: 'Only features marked available are shown as included. Planned or unverified features are not subscription benefits or part of the estimate. Support service levels remain unconfirmed; no response-time guarantee is offered here.' },
    { question: 'Does GIMO file official BIR returns for me?', answer: 'The application supports quarterly reports, preparation worksheets, and exports based on your source records and applicable tax settings. Review the outputs before official filing. This page does not promise automatic filing, accreditation, guaranteed compliance, or final statutory returns.' },
    { question: 'What happens if my workspace reaches capacity?', answer: 'These limits are proposed launch allowances. This page does not apply new restrictions to existing organizations. Before live subscriptions, usage warnings, upgrade or add-on consent, and preservation of existing records and exports must be implemented and approved. You can request capacity now to discuss your needs.' },
  ];
  constructor(private readonly http: HttpClient, public readonly theme: ThemeService,
    private readonly title: Title, private readonly meta: Meta, @Inject(DOCUMENT) private readonly document: Document) {}
  ngOnInit() {
    this.previousTitle = this.title.getTitle();
    this.previousDescription = this.meta.getTag('name="description"')?.content ?? null;
    this.title.setTitle('Pricing | GIMO Biz Assistant');
    this.meta.updateTag({ name: 'description', content: 'Explore proposed Bronze, Silver, and Gold workspace plans for sales, expenses, and Philippine tax preparation. Estimate capacity and request a plan.' });
    this.canonical = this.document.querySelector('link[rel="canonical"]');
    this.previousCanonical = this.canonical?.href ?? null;
    this.canonical?.remove();
    this.loadCatalogue();
  }
  ngOnDestroy() {
    this.subscriptions.unsubscribe(); this.requestDialog.nativeElement.close();
    this.title.setTitle(this.previousTitle);
    if (this.previousDescription === null) this.meta.removeTag('name="description"');
    else this.meta.updateTag({ name: 'description', content: this.previousDescription });
    this.document.querySelector('link[data-pricing-canonical]')?.remove();
    if (this.canonical && this.previousCanonical) { this.canonical.href = this.previousCanonical; this.document.head.appendChild(this.canonical); }
  }
  loadCatalogue() {
    this.loading = true; this.loadError = '';
    this.document.querySelector('link[data-pricing-canonical]')?.remove();
    this.subscriptions.add(this.http.get<{ data: PublicPricing }>('/api/v1/pricing/catalogue', { headers: new HttpHeaders({ 'ngsw-bypass': 'true' }) }).subscribe({
      next: response => {
        try {
          if (!response?.data?.catalogue) throw new Error('Missing pricing catalogue.');
          assertPreviewPublication(response.data.catalogue);
          this.catalogue = response.data.catalogue; this.challenge = response.data.requestChallenge;
          if (response.data.canonicalUrl) {
            const url = new URL(response.data.canonicalUrl);
            if (url.protocol === 'https:' && url.pathname === '/pricing' && !url.username && !url.password && !url.search && !url.hash) {
              const link = this.document.createElement('link'); link.rel = 'canonical'; link.href = url.href; link.setAttribute('data-pricing-canonical', ''); this.document.head.appendChild(link);
            }
          }
        } catch { this.catalogue = null; this.loadError = 'Pricing is temporarily unavailable. Please try again.'; }
        this.loading = false;
      }, error: () => { this.catalogue = null; this.loading = false; this.loadError = 'Pricing is temporarily unavailable. Please try again.'; },
    }));
  }
  setCycle(cycle: BillingCycle) { this.cycle = cycle; }
  money(amountMinor: number) { return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2, minimumFractionDigits: amountMinor % 100 ? 2 : 0 }).format(amountMinor / 100); }
  price(plan: Plan) { return this.cycle === 'monthly' ? plan.monthlyAmountMinor : plan.annualAmountMinor; }
  get desired(): Capacity { return this.capacityForm.getRawValue() as unknown as Capacity; }
  get recommended(): Estimate | null { return this.catalogue && this.capacityForm.valid ? recommendPlan(this.catalogue, this.desired, this.cycle) : null; }
  get estimate(): Estimate | null { return this.catalogue && this.capacityForm.valid ? this.selectedPlanId ? estimatePlan(this.catalogue, this.selectedPlanId, this.desired, this.cycle) : this.recommended : null; }
  planName(id: PlanId) { return this.catalogue?.plans.find(p => p.id === id)?.name || id; }
  get requestEstimate(): Estimate | null { return this.catalogue && (this.requestCapacityForm.valid || this.requestCapacityForm.disabled) ? estimatePlan(this.catalogue, this.requestPlanId, this.requestCapacityForm.getRawValue() as unknown as Capacity, this.requestCycle) : null; }
  capacity(plan: Plan) { return planCapacity(plan); }
  cardFeatures(plan: Plan) {
    return this.catalogue?.features.filter(feature => ['sales', 'expenses', 'quarterly', 'worksheets'].includes(feature.id)
      && feature.availability === 'available' && plan.includedFeatureIds.includes(feature.id)) || [];
  }
  openRequest(planId: PlanId, capacity?: Capacity) {
    if (!this.catalogue || this.submitting) return;
    this.requestPlanId = planId; this.requestCycle = this.cycle;
    this.requestCapacityForm.reset(capacity || planCapacity(this.catalogue.plans.find(p => p.id === planId)!));
    this.requestError = ''; this.requestSuccess = ''; this.requestKey = ''; this.requestFingerprint = '';
    this.previousFocus = this.document.activeElement as HTMLElement;
    this.requestDialog.nativeElement.showModal();
    this.refreshChallenge();
  }
  openEstimateRequest() { const estimate = this.estimate; if (estimate) this.openRequest(estimate.planId, this.desired); }
  closeRequest() { if (this.submitting) return; this.requestDialog.nativeElement.close(); this.previousFocus?.focus(); }
  cancelRequest(event: Event) { if (this.submitting) event.preventDefault(); }
  refreshChallenge() {
    if (this.refreshingChallenge) return;
    this.refreshingChallenge = true;
    this.subscriptions.add(this.http.get<{ data: PublicPricing }>('/api/v1/pricing/catalogue', { headers: new HttpHeaders({ 'ngsw-bypass': 'true' }) }).subscribe({
      next: response => { this.challenge = response?.data?.requestChallenge || null; this.refreshingChallenge = false; },
      error: () => { this.refreshingChallenge = false; this.requestError = 'Unable to prepare the form. Please refresh the form and try again.'; },
    }));
  }
  invalidContact(key: 'name' | 'email' | 'firmName') { const control = this.contactForm.controls[key]; return control.touched && control.invalid; }
  submitRequest() {
    if (this.submitting || this.requestSuccess) return;
    this.contactForm.markAllAsTouched(); this.requestCapacityForm.markAllAsTouched();
    if (!this.challenge) { this.requestError = 'Plan requests are temporarily unavailable. Please refresh the form or try again later.'; return; }
    if (this.contactForm.invalid || this.requestCapacityForm.invalid) { this.requestError = 'Check the form fields before submitting your request.'; return; }
    const contacts = this.contactForm.getRawValue();
    const payload = { ...contacts, name: contacts.name.trim(), email: contacts.email.trim(), firmName: contacts.firmName.trim(), planId: this.requestPlanId, cycle: this.requestCycle, capacity: this.requestCapacityForm.getRawValue() };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== this.requestFingerprint) { this.requestKey = crypto.randomUUID(); this.requestFingerprint = fingerprint; }
    this.submitting = true; this.requestError = '';
    this.contactForm.disable(); this.requestCapacityForm.disable();
    this.subscriptions.add(this.http.post<{ data: { id: string }; message: string }>('/api/v1/pricing/requests', { ...payload, website: this.website, challenge: this.challenge, requestKey: this.requestKey }).subscribe({
      next: response => {
        this.unlockForm();
        if (!response?.data?.id || response.message !== 'Your plan request has been received. No payment has been taken.') { this.requestError = 'We could not confirm your request. Please retry; your details are preserved.'; return; }
        this.requestSuccess = response.message;
      }, error: error => { this.unlockForm(); this.requestError = error?.error?.message || 'Unable to submit your request. Your details are preserved; please try again.'; },
    }));
  }
  private unlockForm() { this.submitting = false; this.contactForm.enable(); this.requestCapacityForm.enable(); }
}
