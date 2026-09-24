# Biz Assistant

Business operations app with an Angular 18 / Tailwind frontend, NestJS API, and MySQL database.

**Hosting on Hostinger:** follow [README-HOSTINGER.md](README-HOSTINGER.md) for the one-time setup, database/file migration, and automatic deployment on GitHub pushes.

## Repository

```text
api/                   NestJS API, Sequelize models/migrations, tests
client/                Angular / Tailwind application
scripts/               Build, startup migration, and Docker deployment helpers
server.js              Combined production application entry point
.env.hostinger.example Hostinger environment template (no real credentials)
dist/                  Generated standalone Hostinger release; ignored by Git
```

The API and client are ordinary directories in this repository. Clone and push this repository only; separate submodule checkouts are no longer needed. Previous API/client repository history remains in the original remote repositories. Existing local nested Git metadata was preserved under `.git/hostinger-submodule-backup/` during conversion.

## Build and test

Use Node.js 22 (see `.nvmrc`).

```bash
npm run build
npm test
```

The build installs dependencies from the API/client lockfiles, compiles both applications, and installs production dependencies in `dist/api`. It does not connect to a database. Do not commit `dist`, credentials, database exports, or uploads.

To run the production release locally, copy `.env.hostinger.example` to `.env.hostinger`, supply your local database connection and an absolute upload directory outside `dist`, set `APP_BASE_URL=http://localhost:3000`, and leave `RUN_MIGRATIONS=false` unless you intend to migrate that database:

```bash
node --env-file=.env.hostinger dist/server.js
```

For Docker development:

```bash
cp .env.example .env  # only on a new checkout; preserve existing settings
# Review credentials and local ports before starting.
docker compose up -d
```

The Docker/VPS deployment files remain available. See [the Docker deployment reference](docs/DEPLOYMENT-DOCKER.md). Those manually triggered GitHub workflows are separate from Hostinger's GitHub deployment integration.

## Dashboard Action Center

Select an organization to see overdue invoices and expenses awaiting approval. Each queue shows five records per page, with links to the existing detail screens. Refresh overview reloads the queues.

- Overdue invoices have a due date before today's local calendar date, an issued/sent/partially paid/overdue status, an unpaid/partially paid/failed payment status, and no paid date. Draft, void, settled, refunded, and undated invoices are excluded. Invoice amounts are full invoice totals, not remaining balances.
- Expenses awaiting approval have `submitted` status and are ordered by expense date, oldest first.
- Dashboard access plus the corresponding invoice or expense read permission is required. Existing detail-screen permissions control edits. Superusers must select an organization; other users remain scoped to their authenticated organization.

This feature uses existing records and requires no database migration.

## Bug reports

The **Report a bug** button in the top bar opens a modal from every signed-in app page. Reports contain a title, description, optional reproduction steps and expected result, and the page path (without query strings or fragments).

Only the `superuser` and `administrator` roles can view reports under **Administration → Bug reports** or update their status. Administrators are restricted to their authenticated organization; superusers can review all organizations or use the workspace selector. Ordinary users receive a submission confirmation but cannot retrieve reports, including their own. Reports are not posted to shared messages or notifications.

Migration `20260923010000-create-bug-reports.js` creates the private report table. Apply it using the normal deployment migration workflow before serving the feature. Report statuses are Open, In progress, Resolved, and Dismissed.

The review page is a Kanban board. Drag a report into another column to save its status, or open the report and use **Move to** on a keyboard or touch device. Each column has its own count and **Load more** button; search matches report titles and descriptions. Failed moves restore the card, and concurrent changes prompt a board refresh.

Select an organization and use **Add column** to create a named, colored status such as “Needs testing”. Custom columns belong to that organization; reports cannot move into another organization's custom column. Superusers can view columns across organizations in the combined overview. New reports continue to start in Open.

Migration `20260923020000-add-bug-report-board.js` adds custom columns and preserves existing report statuses. Its rollback refuses to proceed while reports use custom statuses; move those reports into a default column first. Board reads bypass both API and service-worker caching.

## Database review

See [the schema review](api/docs/schema-review-2026-09-21.md) for relationships, query indexes, and validation. Schema migrations and data migration during a hosting move are separate steps. Import `SequelizeMeta` along with the existing database before enabling automatic migrations.

### Sales order workspace and customer purchase orders

Run `api` migrations through `20260923030000-order-workflow.js` before starting this version. The migration preserves existing orders, adds private PO documents and workflow history, supports multiple invoices per order, and stores stock to three decimal places. Its rollback intentionally requires a verified backup because it contains financial history.

The `/orders/create` and `/orders/:id` pages now share a sales order workspace:

- Save a draft with catalog products/services or custom lines, fractional quantities, a promised date, payment terms, and optional shipping. Prices include the organization's existing applicable tax; withholding is calculated on save. Catalog price overrides require `orders.override_price`. Custom lines do not track inventory.
- Customer records have **Require a verified customer purchase order**. An individual order can also require one. A PO reference, date, amount, and private PDF/PNG/JPEG (up to 5 MB) can be recorded. `orders.verify_po` allows a reviewer to verify the customer PO, including a required note for an amount mismatch or verification without an attachment. Editing a draft or replacing its current PO resets both verification and approval. Uploaded versions remain available in its history.
- Organization **Workflow settings** (`orders.configure`) offer retail/distribution, services, and project presets, customer requirements, shipping and inventory options, approval thresholds, and default payment terms. Settings are copied into each new order. `orders.approve` controls approvals. Admins and superusers retain their existing privileged access; other roles must be granted the new review/configuration permissions explicitly.
- Confirmation (`orders.update`) validates approvals and required POs, locks commercial fields, and atomically commits available catalog product stock. Fulfillment records delivered quantities or service units separately, including partial fulfillment. Completion requires full fulfillment, but does not require invoicing or payment.
- Issue full, deposit, or milestone invoices (`sales_invoices.create`), then record actual payments (`sales_invoices.update`) and refunds (`orders.refund`) against an invoice. These are accounting records, not payment-provider transactions. Tax allocation uses cumulative rounding so the final invoice reconciles to the order. Refunds do not receive inventory back. Invoice changes for managed orders must go through the order workspace; unpaid invoices without any payment history can be voided with a reason.
- Cancellation requires a reason and releases committed stock. Orders with fulfillment, active invoices, or any payment history cannot be cancelled. Only drafts may be deleted. Confirmed commercial terms cannot be edited; cancel an eligible order and create a replacement. Existing finalized orders retain their original history. Unfulfilled, unpaid legacy orders require an administrator with `orders.reconcile` to review whether inventory was already deducted before adopting the workflow; legacy orders with payments or fulfillment remain historical records.
- The orders list adds customer/PO, owner, promised date, fulfillment and invoicing status, and queues for approval, fulfillment, overdue delivery, and invoicing. Search matches order number, customer name, or PO reference.

API writes use a server-generated order number, a UUID `requestKey` for idempotent draft creation, and a `revision` for updates, documents, and actions. Delete requests pass the revision in the query. Use `POST /api/v1/orders/:id/actions` for lifecycle and accounting operations; direct draft updates cannot set status or financial state. Document downloads require order read access and organization scope and are never served through public uploads.

Validation: `npm test` covers workflow calculations and gates. Run `docker exec biz-assitant-api node tests/order-workflow.integration.cjs` explicitly against the migrated development database for isolated, automatically cleaned integration fixtures covering PO access, tenant boundaries, concurrent confirmations, stock, fulfillment, invoicing, payments, refunds, and cancellation. The integration runner refuses production and suppresses outbound email notifications for its synthetic fixtures.

### Orders board view

`/orders` includes Board, Table, and Card views and remembers the selected view. The board uses the existing order lifecycle: Draft, Pending approval, Confirmed, Processing, Completed, Cancelled, and historical Refunded orders. Each column has its own count and pagination, so orders are not limited to the current table page. Organization, search, payment, status, and work-queue filters apply to every column.

Drag a card into an allowed stage or use its **Move to** button on touch devices or with a keyboard. Moves call the same revision-checked order actions as the workspace. Pending orders can be returned to draft; confirmed orders can start processing without recording delivery or changing stock again. Authorized reviewers can approve a pending order directly on its card. Confirmation still requires applicable approvals, verified customer POs, and available stock; completion still requires fulfillment. Cancellation asks for a reason and enforces the existing inventory/financial restrictions. Legacy and finalized records cannot be moved. Record refunds against invoices in the order workspace, rather than dragging an order to Refunded.

### Optional proof of order

New orders and editable drafts show **Proof of order (optional)** above the order sections. Drag and drop files or use **Browse files** to select multiple PDF, PNG, or JPEG documents, up to 5 MB each and 10 per batch. Files upload immediately with individual byte-based progress, finalizing, success, and error states. Two uploads run at a time; remaining files wait in the queue. Failed files can be retried independently, and removing a file cancels its request and discards its temporary upload. **Save draft** attaches the completed uploads in the same transaction as the order changes. Saving is blocked until failed/incomplete entries are retried or removed. Uploading does not make PO verification mandatory; the existing customer/order setting still controls that requirement. New proof resets previous verification and approval when the draft is saved. Attachments lock after confirmation.

Run migration `20260923040000-order-document-uploads.js` before deploying this UI. Temporary files remain private to the uploader, organization, and target order, expire after 24 hours, and are cleaned at startup, hourly, and before subsequent uploads. Each user may hold up to 20 pending uploads across their drafts. Leaving/resetting the form attempts to discard unused uploads; expiry handles interrupted connections. Files continue to use SQL-backed private order-document storage, with no additional storage service required.

`POST /api/v1/orders/document-uploads` accepts `document`, `organizationId`, `uploadId` (a client-generated UUID for idempotent retry), and optional `orderId`. Order create/update requests supply up to 10 returned IDs in `uploadIds`; attachment consumption is atomic and checks ownership, expiry, and the target order. `DELETE /api/v1/orders/document-uploads/:uploadId` discards the uploader's temporary file. Existing JSON and single-file multipart create/update requests and dedicated document upload/download endpoints remain supported.

## Email tickets

The Email tickets workspace turns Gmail or Hostinger email conversations into organization-scoped tickets with teammate/customer assignment, filtering, priorities, due dates, private notes, and replies. See the [email tickets and Gmail setup guide](docs/email-tickets-setup.md) for deployment, Google OAuth configuration, role permissions, and daily use.

Hostinger and Titan mailboxes are configured per organization in the frontend. See the [Hostinger mailbox setup guide](docs/hostinger-email-setup.md).
