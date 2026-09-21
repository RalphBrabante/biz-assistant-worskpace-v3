# NestJS Enterprise Structure

This API now boots with NestJS (`src/main.ts`) and keeps existing business endpoints available through the legacy integration service while feature modules are migrated.

## Folder Layout

- `src/main.ts`: Nest bootstrap entry point.
- `src/app.module.ts`: root module.
- `src/modules/<domain>/`
  - `controllers/`
  - `services/`
  - `repositories/`
  - `entities/`
  - `dto/`
  - `interfaces/`
- `src/shared/`
  - common cross-cutting concerns (`guards`, `filters`, `interceptors`, etc.).
- `src/infrastructure/`
  - integration concerns (`database`, `cache`, `messaging`, `jobs`, `storage`, `config`).

## Transition Strategy

1. Keep all existing routes working via `LegacyApiService`.
2. Each current domain now has a dedicated Nest module skeleton:
   - `auth`, `system`, `items`, `organizations`, `orders`, `users`, `roles`, `permissions`,
     `licenses`, `sales-invoices`, `customers`, `expenses`, `vendors`, `reports`, `settings`,
     `tax-types`, `withholding-tax-types`, `profile`, `messages`, `dev`.
3. Migrate one domain at a time into full Nest implementation (`controllers/services/repositories/entities/dto`).
3. Remove legacy route registrations per domain after migration.
4. Keep Sequelize models/migrations compatible during migration.
