import { Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

/** Small, keyboard-accessible tooltip with no third-party DOM runtime. */
@Directive({ selector: '[appTooltip]', standalone: true })
export class TooltipDirective implements OnDestroy {
  private tooltip?: HTMLElement;
  private title = '';
  private previousDescription: string | null = null;
  private static nextId = 0;
  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  @HostListener('mouseenter')
  @HostListener('focusin')
  show(): void {
    const host = this.elementRef.nativeElement;
    if (this.tooltip) return;
    this.title = host.getAttribute('title') || '';
    if (!this.title) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'app-tooltip';
    tooltip.id = `app-tooltip-${TooltipDirective.nextId++}`;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = this.title;
    document.body.appendChild(tooltip);
    this.tooltip = tooltip;
    this.previousDescription = host.getAttribute('aria-describedby');
    host.setAttribute('aria-describedby', [this.previousDescription, tooltip.id].filter(Boolean).join(' '));
    host.removeAttribute('title');
    const rect = host.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - box.width) / 2, window.innerWidth - box.width - 8))}px`;
    tooltip.style.top = `${rect.top > box.height + 12 ? rect.top - box.height - 8 : Math.min(rect.bottom + 8, window.innerHeight - box.height - 8)}px`;
  }

  @HostListener('mouseleave')
  @HostListener('focusout')
  @HostListener('click')
  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  hide(): void {
    if (!this.tooltip) return;
    const host = this.elementRef.nativeElement;
    this.tooltip.remove();
    this.tooltip = undefined;
    if (!host.hasAttribute('title')) host.setAttribute('title', this.title);
    if (this.previousDescription) host.setAttribute('aria-describedby', this.previousDescription);
    else host.removeAttribute('aria-describedby');
  }
  ngOnDestroy(): void { this.hide(); }
}
