# GIMO Biz Assistant — Business Logic Reference

This file is loaded automatically by Claude Code on every prompt. It documents the full application context so Claude understands the system without re-exploring the codebase each time.

---

## What This Application Is

**GIMO Biz Assistant** is a multi-tenant business management SaaS platform targeting small-to-medium businesses in the Philippines. It handles:

- Sales orders and invoicing (with PH VAT / withholding tax support)
- Expense tracking and vendor management
- Quarterly sales and expense reports (BIR-style)
- Role-based access control (RBAC) with granular permissions
- Multi-organization support (users can belong to many orgs)
- File storage (Google Drive or DigitalOcean Spaces)
- Real-time notifications via WebSocket/Socket.io
- License management (expiry tracking and notifications)
- Email notifications (SMTP2GO)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 18, Bootstrap 5, Chart.js, Socket.io client |
| Backend | Node.js + Express (legacy), NestJS (migration in progress) |
| ORM | Sequelize with MySQL 8.4 |
| Cache | Redis 7 |
| Queue | RabbitMQ 3 |
| Proxy | Nginx 1.27 |
| Orchestration | Docker Compose |
| Email | SMTP2GO API |
| File Storage | Google Drive OAuth2 or DigitalOcean Spaces (S3-compatible) |

---

## Repository Structure

```
gimo-assistant-workspace-v3/
├── api/                     # Backend (git submodule)
│   └── src/
│       ├── models/          # 27 Sequelize models
│       ├── migrations/      # 61+ DB migrations
│       ├── seeders/         # RBAC defaults, superuser, tax types
│       ├── controllers/     # 20 legacy Express controllers
│       ├── routes/          # 20 legacy Express route files
│       ├── modules/         # NestJS feature modules (migration in progress)
│       ├── services/        # Email, cache, storage, messaging
│       ├── middleware/      # Auth, error handling, caching
│       ├── main.ts          # NestJS bootstrap entry point
│       ├── index.js         # Legacy Express app setup
│       └── app.module.ts    # NestJS root module
├── client/                  # Frontend Angular 18 (git submodule)
│   └── src/
│       ├── app.routes.ts    # Angular routing config
│       ├── core/            # API service, auth service, notifications
│       ├── layout/          # App shell component
│       ├── pages/           # 36 page components
│       └── shared/          # Shared utilities, directives
├── nginx/                   # Nginx configs (dev, dev+phpMyAdmin, SSL prod)
├── mysql/                   # MySQL optimization config
├── redis/                   # Redis config (eviction policy)
├── rabbitmq/                # RabbitMQ memory guardrails
├── postman/                 # Complete Postman API collection
├── docker-compose.yml       # Dev base compose
├── docker-compose.dev.yml   # Dev overrides (hot reload, phpMyAdmin)
├── docker-compose.prod.yml  # Production (resource limits, external DB)
└── .env.example             # Template for environment variables
```

---

## Service Topology

```
Browser → Nginx (80/443)
            ├── /           → Angular SPA (static files)
            ├── /api/*      → API (Node/NestJS :3000)
            ├── /socket.io  → Socket.io (real-time)
            ├── /uploads/*  → File upload handler
            └── /db/        → phpMyAdmin (dev only)

API connects to:
  MySQL  :3306  — primary data store (Sequelize)
  Redis  :6379  — response caching, session-adjacent storage
  RabbitMQ :5672 — background jobs (license expiry checks, email dispatch)
```

**Networks (Production):**
- `frontend-network`: nginx only (public)
- `backend-network`: api, redis, rabbitmq (internal, isolated)
- MySQL: external managed DB (DigitalOcean, AWS RDS, etc.)

---

## Data Models (27 Sequelize Models)

### Multi-Tenancy & Auth
| Model | Key Fields | Notes |
|---|---|---|
| User | id, name, email, password (hashed), isActive, isEmailVerified | Core user entity |
| Organization | id, name, slug, isActive, settings | Tenant root |
| OrganizationUser | userId, organizationId, isPrimary | Many-to-many; `isPrimary` marks default org |
| Role | id, name, organizationId, isSystem | System roles cannot be deleted |
| UserRole | userId, roleId, organizationId | User-to-role assignment scoped to org |
| Permission | id, name, resource, action | e.g., `orders.create`, `reports.read` |
| RolePermission | roleId, permissionId | |
| Token | userId, token (sha256), type, expiresAt | Password reset, email verification |
| InvalidLoginAttempt | userId, ip, count, lockedUntil | Brute-force protection |
| License | organizationId, planType, expiresAt, isActive | Drives feature availability |

### Sales & Invoicing
| Model | Key Fields | Notes |
|---|---|---|
| Order | id, orgId, customerId, status, total, tax, subtotal | Statuses: draft→pending→confirmed→processing→completed/cancelled/refunded |
| OrderItemSnapshot | orderId, itemId, name, qty, unitPrice, taxAmount | Immutable snapshot at order time for auditing |
| OrderActivity | orderId, userId, action, metadata | Full audit trail |
| SalesInvoice | id, orderId, orgId, status, dueDate, total | Statuses: draft→issued→sent→paid/partially_paid/overdue/void |
| Customer | id, orgId, name, email, address, tin | TIN for tax compliance |
| Item | id, orgId, name, sku, price, cost, unit, taxTypeId | Links to TaxType for VAT rate |
| PurchaseOrder | id, orgId, vendorId, status, total | Vendor purchase tracking |

### Expenses & Vendors
| Model | Key Fields | Notes |
|---|---|---|
| Expense | id, orgId, vendorId, amount, vatAmount, withholdingTaxAmount, attachmentUrl | Full tax breakdown |
| Vendor | id, orgId, name, tin, category, bankDetails | Category used for tax classification |

### Taxes & Reporting
| Model | Key Fields | Notes |
|---|---|---|
| TaxType | id, orgId, name, rate, isSystem | VAT configs per org; system defaults protected |
| WithholdingTaxType | id, orgId, name, rate, atcCode | ATC codes for BIR compliance |
| QuarterlySalesReport | id, orgId, quarter, year, totalSales, totalVat | Auto-generated from orders |
| QuarterlyExpenseReport | id, orgId, quarter, year, totalExpenses, totalVat | Auto-generated from expenses |

### Communication & Config
| Model | Key Fields | Notes |
|---|---|---|
| Message | id, orgId, fromUserId, toUserId, content, isRead | Internal messaging |
| AppSetting | key, value, orgId | Key-value store for org and global settings |

---

## API Endpoints (v1)

Base path: `/api/v1`

### Authentication
```
POST   /auth/login
GET    /auth/session
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/request-email-verification
POST   /auth/verify-email
```

### Core Resources (CRUD)
```
/organizations        GET (list), POST (create)
/organizations/:id    GET, PUT, DELETE
/users                GET, POST
/users/:id            GET, PUT, DELETE
/items                GET, POST
/items/:id            GET, PUT, DELETE
/orders               GET, POST
/orders/create        POST
/orders/:id           GET, PUT, DELETE
/sales-invoices       GET, POST
/sales-invoices/:id   GET, PUT, DELETE
/expenses             GET, POST
/expenses/:id         GET, PUT, DELETE
/vendors              GET, POST
/vendors/:id          GET, PUT, DELETE
/customers            GET, POST
/customers/:id        GET, PUT, DELETE
/roles                GET, POST
/roles/:id            GET, PUT, DELETE
/permissions          GET
/licenses             GET, POST
/license/:id          GET, PUT
```

### Reporting
```
GET /reports
GET /reports/:id
GET /reports/sales/:id
```

### Settings & Integrations
```
GET  /settings
PUT  /settings
GET  /settings/storage/*
POST /settings/storage/google-drive/callback   (OAuth2 callback)
```

### Profile
```
GET  /profile
PUT  /profile
POST /profile/change-password
```

### System
```
GET  /health
POST /messages
```

---

## Frontend Routes (Angular)

### Public (no auth)
```
/login
/reset-password
/verify-email
/privacy-policy
/terms-of-service
```

### Protected (requires JWT + permission guards)
```
/dashboard
/organizations         [organizations.read]
/organizations/:id     [organizations.read]
/users                 [users.read]
/users/:id             [users.read]
/roles                 [roles.read]
/roles/:id             [roles.read]
/permissions           [permissions.read]
/items                 [items.read]
/orders                [orders.read]
/orders/create         [orders.create]
/orders/:id            [orders.read]
/sales-invoices        [sales-invoices.read]
/sales-invoices/:id    [sales-invoices.read]
/customers             [customers.read]
/expenses              [expenses.read]
/expenses/:id          [expenses.read]
/vendors               [vendors.read]
/taxes                 [tax-types.read]
/licenses              [licenses.read]
/license/:id           [licenses.read]
/reports               [reports.read]
/reports/:id           [reports.read]
/reports/sales/:id     [reports.read]
/settings              [settings.read]
/profile               (any authenticated user)
/messages              (any authenticated user)
```

Guards: `authGuard` (JWT validation) + `permissionGuard` (resource.action checks)

---

## Business Logic Rules

### Multi-Tenancy
- Every resource (order, invoice, expense, item, etc.) is scoped to an `organizationId`.
- A user can belong to multiple organizations; `OrganizationUser.isPrimary` marks the default.
- Effective organization is resolved per-request from the JWT context.
- Users see only data belonging to their active organization.

### RBAC
- Roles are defined per organization; system roles (`isSystem=true`) cannot be deleted.
- Permissions follow `resource.action` pattern (e.g., `orders.create`, `reports.read`).
- Superuser role bypasses all permission checks.
- Role changes take effect immediately (no re-login required).

### Orders & Invoicing Flow
1. Order created as `draft` → progresses through: `pending → confirmed → processing → completed`
2. Cancellation and refund are terminal states.
3. `OrderItemSnapshot` freezes item details (name, price, tax) at order creation for audit integrity — item changes don't retroactively affect orders.
4. `SalesInvoice` is generated from a completed or confirmed order.
5. Invoice statuses: `draft → issued → sent → paid | partially_paid | overdue | void`.
6. VAT and withholding tax are calculated and stored as separate columns on each invoice/expense.

### Tax Calculations (Philippine BIR Compliance)
- `TaxType` stores VAT rates; items reference a `taxTypeId`.
- `WithholdingTaxType` uses ATC (Alphanumeric Tax Code) codes for BIR classification.
- Both VAT amount and withholding tax amount are stored separately on invoices and expenses.
- `QuarterlySalesReport` and `QuarterlyExpenseReport` auto-aggregate data by quarter/year for BIR reporting.

### Expenses
- Each expense can attach a file (stored in configured storage provider).
- Full tax breakdown: base amount + VAT amount + withholding tax amount.
- Linked to a Vendor (with TIN and category for tax classification).

### Licenses
- Each organization has a License record with `expiresAt` and `isActive`.
- A background job (via RabbitMQ) checks for expiring/expired licenses and sends notifications.
- License expiry triggers real-time Socket.io notifications and email via SMTP2GO.

### File Storage
- Configurable provider per org: Local FS, Google Drive (OAuth2), or DigitalOcean Spaces.
- Google Drive uses OAuth2 with refresh token stored in `AppSetting`.
- `cdnUrl` field stored alongside file paths for optimized delivery.
- Used for: expense attachments, profile images.

### Caching
- Redis caches API responses; cache is invalidated on write operations.
- `readCacheMiddleware` and `invalidateCacheOnWriteMiddleware` handle this automatically.
- Cache is optional and toggleable per deployment.

### Security
- Passwords hashed (bcrypt); JWTs stored as sha256 hash in `Token` table.
- Token revocation supported (logout invalidates stored token).
- Invalid login attempt tracking with lockout (`InvalidLoginAttempt` model).
- Email verification required before full access.
- RBAC enforced at both API middleware and Angular route guard levels.

---

## External Integrations

| Service | Purpose | Config Keys |
|---|---|---|
| SMTP2GO | Transactional email (password reset, invites, license alerts) | `SMTP2GO_API_KEY` |
| Google Drive | File storage (OAuth2) | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` |
| DigitalOcean Spaces | Alternative file storage (S3-compatible) | `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_BUCKET` |

Email templates cover: password reset, email verification, organization invite, license revocation.

---

## Architecture Notes (NestJS Migration)

- The API is currently **hybrid**: NestJS bootstraps the app, but legacy Express routes are still active via `LegacyApiModule`.
- New feature work should be added as **NestJS modules** in `api/src/modules/`.
- Legacy controllers in `api/src/controllers/` are being migrated one domain at a time.
- Sequelize models remain shared between legacy and NestJS code during the transition.
- `api/src/ARCHITECTURE.md` documents the migration strategy in detail.

---

## Development Setup

```bash
# Start development environment (hot reload + phpMyAdmin)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# phpMyAdmin available at: http://localhost/db/
# API at: http://localhost/api/v1/
# App at: http://localhost/
```

---

## Staging & Production on DigitalOcean

Each environment runs on its own droplet (separate IP, separate domain).
Docker Compose project isolation (`-p <env>`) prevents container/volume name conflicts.

### Environment files

| File | Purpose |
|---|---|
| `.env.staging.example` | Template for staging — copy to `.env.staging` |
| `.env.production.example` | Template for production — copy to `.env.production` |

### Compose files

| File | Environment | DB |
|---|---|---|
| `docker-compose.staging.yml` | Staging | Local MySQL (included) |
| `docker-compose.prod.yml` | Production | External managed DB |

### Quickstart (on the droplet)

```bash
# 1. Clone repo with submodules
git clone --recurse-submodules <repo-url> .

# 2. Set up SSL cert (Cloudflare origin cert)
mkdir -p nginx/certs
# Copy fullchain.pem and privkey.pem to nginx/certs/

# 3. Configure environment
cp .env.staging.example .env.staging   # or .env.production.example
nano .env.staging

# 4. Build client + start services
bash scripts/deploy.sh staging         # or production
```

### Makefile targets (convenience wrappers)

```bash
make help                # List all targets

make deploy-staging      # Full deploy: git pull + client build + up
make deploy-production   # Full deploy: git pull + client build + up

make build-staging       # Rebuild Angular client only
make logs-staging        # Tail logs
make status-staging      # Show container status
make stop-staging        # Stop containers
make shell-staging       # Open shell in API container
make migrate-staging     # Run DB migrations manually

make seed-staging        # Run all DB seeds (first deploy only)
make seed-production     # Run all DB seeds (first deploy only)
```

### Key differences: staging vs production

| | Staging | Production |
|---|---|---|
| MySQL | Local container included | External managed DB |
| DB logging | `DB_LOG_SQL=true` | `DB_LOG_SQL=false` |
| `APP_ENV` | `staging` | (not set) |
| `APP_BASE_URL` | `https://staging.your-domain.com` | `https://your-domain.com` |
| Nginx config | `nginx/default.ssl.conf` (same) | `nginx/default.ssl.conf` |

### SSL certificates

Both environments use Cloudflare Origin Certificates mounted from `nginx/certs/`:
```
nginx/certs/fullchain.pem   # Cloudflare origin certificate
nginx/certs/privkey.pem     # Private key
```
Cloudflare handles public HTTPS termination; Nginx uses origin certs for the Cloudflare↔origin leg.

### Min server specs (per environment)

- Ubuntu 24.04 LTS
- **Production**: 2GB RAM, 1 vCPU, 50GB SSD
- **Staging**: 1GB RAM, 1 vCPU, 25GB SSD (tight; 2GB recommended)

---

## Key File Locations

| What | Where |
|---|---|
| API entry | `api/src/main.ts` (NestJS) / `api/src/index.js` (legacy) |
| DB models | `api/src/models/` |
| DB migrations | `api/src/migrations/` |
| DB seeders | `api/src/seeders/` |
| NestJS modules | `api/src/modules/` |
| Legacy controllers | `api/src/controllers/` |
| Legacy routes | `api/src/routes/` |
| Angular routes | `client/src/app.routes.ts` |
| Angular pages | `client/src/pages/` |
| Core services | `client/src/core/` |
| Nginx configs | `nginx/default*.conf` |
| Postman collection | `postman/gimo-api.postman_collection.json` |
| Architecture notes | `api/src/ARCHITECTURE.md` |

---

## UI Standard: Data Page Filter Card

Every data listing page (`/orders`, `/items`, `/expenses`, `/customers`, `/vendors`, `/users`, `/sales-invoices`, etc.) **must** use the following filter card layout. Do not deviate from this structure.

### Structure

```
<section class="card border-0 shadow-sm rounded-4 mb-4">
  <div class="card-body p-4">

    <!-- Row 1: Primary filters -->
    <div class="row g-3 align-items-end">
      <!-- Search (always first, col-12 col-md-4 or col-md-5) -->
      <!-- Additional filter selects: col-6 col-md-2 each -->
      <!-- Date range (when applicable): col-12 col-md-4 using input-group with "to" separator -->
    </div>

    <!-- Row 2: Secondary controls -->
    <div class="row g-3 align-items-center mt-1">
      <!-- "Show" rows-per-page input-group: col-6 col-md-2 -->
      <!-- View toggle (table/card): col-6 col-md-2 -->
      <!-- Stats + Clear button: col-12 col-md-4 d-flex justify-content-md-end -->
    </div>

    <!-- Active filter chips (conditional on hasActiveFilters) -->
    <div *ngIf="hasActiveFilters" class="d-flex flex-wrap align-items-center gap-2 mt-3 pt-3 border-top">
      <!-- One dismissible badge pill per active filter -->
    </div>

    <!-- Alerts -->
    <div *ngIf="message()" class="alert alert-success mt-3 mb-0">...</div>
    <div *ngIf="error()" class="alert alert-danger mt-3 mb-0">...</div>
  </div>
</section>
```

### Rules

**Search field** — always uses inline search icon + inline clear (×) button:
```html
<div class="position-relative">
  <i class="bi bi-search position-absolute text-secondary" style="left:0.75rem;top:50%;transform:translateY(-50%);pointer-events:none;"></i>
  <input type="text" class="form-control ps-5" [class.pe-5]="searchQuery" placeholder="..." />
  <button *ngIf="searchQuery" class="btn position-absolute p-0 border-0 bg-transparent text-secondary"
    style="right:0.75rem;top:50%;transform:translateY(-50%);" type="button" (click)="clearSearch()">
    <i class="bi bi-x-circle-fill"></i>
  </button>
</div>
```

**Filter selects** — use `[class.border-primary]="filterValue"` to highlight active state. Options use friendly Title Case labels, never raw snake_case values.

**Date range** — inline `input-group` with a `<span class="input-group-text ...">to</span>` separator between the two date inputs.

**Rows per page** — always an `input-group` with a `"Show"` prefix span:
```html
<div class="input-group">
  <span class="input-group-text border-end-0 text-secondary small px-2">Show</span>
  <select class="form-select border-start-0" ...>...</select>
</div>
```

**View toggle** — always `btn-group view-toggle-group` with table and card buttons using `[class.active]="viewMode === 'table/card'"`.

**Stats + Clear button** — right-aligned in a flex container:
- Stats text: `<span class="fw-semibold text-body">{{ total }}</span> items · Page X / Y`
- Clear button: `btn-outline-secondary` when no filters active, `btn-outline-danger` when active, `[disabled]="!hasActiveFilters"`, shows `badge text-bg-danger` with count when `activeFilterCount > 0`

**Active filter chips** — shown only when `hasActiveFilters` is true. Each chip is a `badge rounded-pill border fw-normal text-body bg-body` with an icon, label text, and a `btn-close` that removes only that filter.

### Required TypeScript properties (every data page must have)

```typescript
// Getters
get hasActiveFilters(): boolean { ... }   // true if any filter is active
get activeFilterCount(): number { ... }   // count of active filters for badge

// Method
clearFilters(): void { ... }              // resets all filters and reloads

// Label methods (for pages with status/payment selects)
orderStatusLabel(value: string): string   // maps raw value → "Friendly Label"
// etc. — one method per select filter
```

### Pages using this standard

| Page | Filter fields |
|---|---|
| `/orders` | search, status, payment |
| `/items` | search, vendor (autocomplete) |
| `/expenses` | search, status, payment method, date range |
| `/customers` | search |
| `/vendors` | search |
| `/users` | search |
| `/sales-invoices` | search, status, payment status, date range, sort |
