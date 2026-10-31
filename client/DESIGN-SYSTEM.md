# Workspace design system

The application uses Tailwind CSS 3 with Angular 18's existing build pipeline. Bootstrap CSS, JavaScript, and types have been removed. The independent `bootstrap-icons` font remains for icons; it does not load the Bootstrap framework. Inter is served locally through `@fontsource/inter`.

## Visual foundations

- A charcoal navigation rail, neutral surfaces, and indigo primary actions establish the application hierarchy.
- Theme tokens live in `src/styles.css`. Tailwind exposes semantic colors such as `canvas`, `surface`, `ink`, `muted`, `line`, `line-strong`, and `brand`.
- Colors that stay the same in both themes are named in `tailwind.config.js`: `brand-fill`, `success-fill`, and `danger-fill` for white-on-color buttons, `chrome-*` for the navigation rail and sign-in artwork, and `chart-*` for dashboard legends. Do not put hex values in class names.
- Theme text and fill tokens meet WCAG AA (4.5:1) on the surfaces they are used on. Re-check contrast when changing a token.
- The smallest text is `text-2xs` (11px).
- Light and dark themes share components. `ThemeService` sets `data-theme` on the document root.
- Use Tailwind spacing, flex, grid, and responsive utilities in templates. The desktop navigation starts at `lg` (1024px); smaller screens use a drawer.
- Keep complete class names in templates or TypeScript strings so Tailwind's content scanner can discover them.

## Shared components

Reusable styles are defined in Tailwind's components layer in `src/styles.css`: `ui-btn`, `ui-card`, `ui-form-control`, `ui-form-select`, `ui-table`, `ui-badge`, `ui-alert`, their variants, and the workspace frame. Utilities can override these styles without adding page-specific copies. Component stylesheets remain for layouts specific to one page, such as the order board and chat panel; they should use the theme variables rather than fixed colors, except for printed documents that must stay black on white.

Static `style` attributes are not used in templates; use utilities, including arbitrary values such as `max-h-[280px]`. Tailwind has no effect on Bootstrap class names, so use `pointer-events-none` rather than `pe-none`.

Use `page-heading` for page introductions, with one primary action and secondary controls alongside it. Place dense tables inside `ui-table-responsive` so they scroll inside their panels instead of widening the page.

Interactive replacements are standalone Angular directives:

- `appDropdown` on a button beside a `.ui-dropdown-menu`: outside-click dismissal, arrow-key navigation, Escape, and viewport-aware positioning.
- `appModal` on Angular-controlled `.ui-modal` containers: dialog semantics, focus trapping, focus restoration, Escape, and stacked scroll locks. Use `.ui-modal-dialog-scrollable` for long forms. Native `<dialog>` elements retain their native modal behavior.
- `appTooltip` with a `title`: plain-text tooltips, keyboard visibility, and accessible descriptions.

Import the corresponding directive into each standalone component using it. Do not add Bootstrap data attributes or initialize third-party DOM widgets.

## Validation

```sh
node --test tests/design-system.test.cjs tests/expense-calculation.test.cjs tests/organization-messages.test.cjs tests/ui-interactions.test.cjs
NG_BUILD_MAX_WORKERS=2 npm run build -- --progress=false
```

Migration review on 2026-09-21: 18 regression tests passed, and the production build completed without warnings. Browser checks covered the dashboard, expenses and entry dialog, messages, sign-in, organizations, items, customers, orders, invoices, vendors, taxes, reports, users, and settings. Light/dark themes, narrow layouts, dropdown keyboard navigation, and modal focus restoration were reviewed. No financial records were saved during this visual review.

The initial production JavaScript/CSS bundle decreased from approximately 1.92 MB to 1.58 MB. This measurement excludes separately downloaded font assets.

Build integration reference: [Tailwind CSS 3's Angular guide](https://v3.tailwindcss.com/docs/guides/angular).
