import { Directive, ElementRef, HostListener, OnDestroy } from '@angular/core';

@Directive({ selector: '[appDropdown]', standalone: true })
export class DropdownDirective implements OnDestroy {
  private static active?: DropdownDirective;
  private open = false;
  private get host(): HTMLButtonElement { return this.element.nativeElement; }
  constructor(private readonly element: ElementRef<HTMLButtonElement>) {}
  private get menu(): HTMLElement | null { return this.host.parentElement?.querySelector('.ui-dropdown-menu') || null; }
  private items(): HTMLElement[] { return Array.from(this.menu?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') || []); }
  private setOpen(open: boolean): void {
    if (open && DropdownDirective.active !== this) { DropdownDirective.active?.setOpen(false); DropdownDirective.active = this; }
    this.open = open;
    this.host.setAttribute('aria-expanded', String(open));
    this.host.parentElement?.classList.toggle('menu-open', open);
    this.menu?.classList.toggle('show', open);
    const menu = this.menu;
    if (menu) {
      menu.style.display = open ? 'block' : '';
      if (open) {
        const rect = this.host.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.right = 'auto';
        menu.style.maxHeight = `${Math.max(120, window.innerHeight - 24)}px`;
        menu.style.overflowY = 'auto';
        const box = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right - box.width, window.innerWidth - box.width - 8))}px`;
        menu.style.top = `${rect.bottom + box.height + 8 < window.innerHeight ? rect.bottom + 6 : Math.max(8, rect.top - box.height - 6)}px`;
      }
    }
  }
  @HostListener('click', ['$event']) toggle(event: MouseEvent): void { event.stopPropagation(); this.setOpen(!this.open); }
  @HostListener('document:click', ['$event']) outside(event: MouseEvent): void {
    if (this.open && event.target !== this.host && !this.host.contains(event.target as Node)) this.setOpen(false);
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent): void {
    const active = document.activeElement as HTMLElement;
    if (active !== this.host && !this.menu?.contains(active)) return;
    if (event.key === 'Escape' && this.open) { event.preventDefault(); this.setOpen(false); this.host.focus(); }
    if (event.key === 'Tab') this.setOpen(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); this.setOpen(true);
      const items = this.items();
      const index = items.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }
  @HostListener('window:resize')
  @HostListener('document:scroll')
  closeOnViewportChange(): void { if (this.open) this.setOpen(false); }
  ngOnDestroy(): void { this.setOpen(false); if (DropdownDirective.active === this) DropdownDirective.active = undefined; }
}
