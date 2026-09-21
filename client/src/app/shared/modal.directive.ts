import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

/** Focus management for Angular-controlled modal panels. Native dialogs manage themselves. */
@Directive({ selector: '[appModal]', standalone: true })
export class ModalDirective implements AfterViewInit, OnDestroy {
  private static stack: ModalDirective[] = [];
  private static previousOverflow = '';
  private previousFocus: HTMLElement | null = null;
  private get host(): HTMLElement { return this.element.nativeElement; }
  constructor(private readonly element: ElementRef<HTMLElement>) {}
  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement as HTMLElement;
    if (!ModalDirective.stack.length) { ModalDirective.previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    ModalDirective.stack.push(this);
    this.host.setAttribute('role', 'dialog'); this.host.setAttribute('aria-modal', 'true');
    const title = this.host.querySelector<HTMLElement>('.ui-modal-title, h2, h5');
    if (title) this.host.setAttribute('aria-label', title.textContent?.trim() || 'Dialog');
    queueMicrotask(() => this.focusable()[0]?.focus());
  }
  private focusable(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
  }
  @HostListener('document:keydown', ['$event']) keydown(event: KeyboardEvent): void {
    if (ModalDirective.stack.at(-1) !== this) return;
    if (event.key === 'Escape') { event.preventDefault(); this.host.querySelector<HTMLButtonElement>('.ui-btn-close:not(:disabled)')?.click(); }
    if (event.key !== 'Tab') return;
    const items = this.focusable(); const first = items[0]; const last = items.at(-1);
    if (!first) { event.preventDefault(); this.host.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !this.host.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !this.host.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }
  ngOnDestroy(): void {
    ModalDirective.stack = ModalDirective.stack.filter(item => item !== this);
    if (!ModalDirective.stack.length) document.body.style.overflow = ModalDirective.previousOverflow;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}
