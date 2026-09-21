# Database schema review — 2026-09-21

## Scope and findings

Reviewed all 26 application tables, 64 database foreign keys, Sequelize associations, migration history, and indexes against the list, dashboard, reporting, inbox, and order-history query patterns. The audit used the local Docker MySQL 8.4 database (`biz-assitant-mysql`, `appdb`). No production or remote database was migrated.

The schema already has primary keys, foreign keys, and organization-scoped business-reference uniqueness. The main gaps were missing composite query indexes, duplicate unique indexes, and drift between a few ORM relationships and the migrated database.

## Implemented

Migration: `20260921010000-optimize-workspace-indexes.js`.

| Table | New index columns | Supported queries |
| --- | --- | --- |
| expenses | organization_id, created_at | Recent expenses and paginated lists |
| expenses | organization_id, status, created_at | Approval/payment queues and filtered lists |
| expenses | organization_id, expense_date | Organization-specific date-range reports |
| sales_invoices | organization_id, created_at | Recent invoices and paginated lists |
| sales_invoices | organization_id, status, created_at | Status counts and filtered lists |
| sales_invoices | organization_id, issue_date | Organization-specific date-range reports |
| orders | organization_id, created_at | Organization order lists |
| orders | organization_id, status, created_at | Pipeline counts and filtered lists |
| messages | organization_id, created_at | Organization inbox |
| messages | organization_id, is_read, created_at | Unread counts, read/unread inbox, and bulk read selection |
| order_activities | order_id, created_at | Per-order activity history |

Removed nine exact duplicate unique indexes: `app_settings.key`, `licenses.key`, `licenses.key_2`, `permissions.code`, `roles.code`, `roles.name`, `tax_types.code`, `tokens.token_hash`, and `users.email`. Each table retains its existing named unique index. Matching attribute-level duplicate declarations were removed from the ORM; unique model indexes remain. The framework-owned `SequelizeMeta` table was not changed.

List queries now use the unique record ID as the final sort key after creation time. This keeps pagination deterministic for imports whose rows share a timestamp, regardless of which index MySQL selects.

Relationship corrections:

- Expense/vendor associations now declare a nullable vendor reference with `ON DELETE SET NULL`, matching the existing February migration and live foreign key. This aligns model-created schemas with the established database behavior; it does not change the live deletion policy.
- Vendor-sharing membership `createdBy`/`updatedBy` associations now reference users with `SET NULL`, matching the existing database audit foreign keys.
- Creating an invoice with an order now validates that both belong to the same organization. Missing and cross-organization orders return HTTP 400 before a write. Standalone invoices remain supported. This is an API ownership check, not a new database composite foreign key.

## Verification and measured results

- Migration applied successfully to local `appdb`.
- SHA-256 fingerprints of every application row, ordered by primary key, matched before and after: **915 records across 26 tables unchanged**. Only schema metadata and `SequelizeMeta` changed.
- Post-migration audit: **64 foreign keys**, no orphaned records, no model/database foreign-key mismatches, and no exact duplicate application indexes.
- Invoice/order, order/customer, and order/activity checks found no cross-organization references in existing data.
- All **45 API tests** passed; the TypeScript production build passed.
- A disposable MySQL database containing empty copies of the affected table definitions passed repeated `up/down/up`, idempotency, unique-key enforcement, and fixture-preservation tests. It was removed after testing. No business rows were copied into it.
- Unit tests cover interrupted migration recovery, preflight conflicts, retained uniqueness, model/index alignment, and invoice ownership validation.

Representative `EXPLAIN` results, without forced index hints:

| Query | Before | After |
| --- | --- | --- |
| Recent expenses | Table scan + filesort | `expenses_org_created_idx`, backward index scan, no filesort |
| Expenses filtered by paid status | Table scan + filesort | Indexed ordered scan, no filesort |
| Recent sales invoices | Table scan + filesort | `sales_invoices_org_created_idx`, no filesort |
| Orders filtered by status | Organization index + filesort | Indexed ordered scan, no filesort |
| Order activity | Table scan + filesort | `order_activities_order_created_idx`, no filesort |

The full-year aggregates and tiny unread-message result still use the optimizer's existing scan/index choices on this small dataset. Their new composite indexes are available for more selective/larger workloads; no latency improvement is claimed without a representative benchmark. Indexes also add storage and write-maintenance cost. Raw before/after plans are in [schema-query-plans-2026-09-21.json](schema-query-plans-2026-09-21.json).

## Operations

Use the environment's normal database credentials; scripts never print them.

```sh
npm run db:audit
npm run test:schema
npm run build
npm run db:migrate
```

`db:audit` is read-only and emits metadata and counts, not business record contents. For the optional MySQL integration test, use a local/test server account allowed to create a disposable database and set `SCHEMA_TEST_DATABASE=schema_review_test_<unique_suffix>` before `npm run test:schema:mysql`. The script refuses unrelated names and an already-existing target; it drops only the scratch database it successfully created.

The migration preflights all named definitions and refuses conflicting definitions before changing indexes. Each DDL step is restartable. MySQL DDL is not transactionally rolled back, so an interrupted `up` should be retried. `down` restores the known legacy duplicate indexes and removes the 11 workload indexes; uniqueness remains enforced throughout. Roll back by this specific migration name only, after checking deployment state.

For a larger production database, test against its schema first and schedule the DDL appropriately: index creation still uses resources and can wait for metadata locks. This migration uses MySQL's normal index DDL behavior and does not claim zero blocking.

## Deliberately retained

Existing cascade-delete policies on financial records and organizations were not changed; altering retention semantics needs a separate product decision. No historical values, tax calculations, UUID storage formats, monetary types, or nullable business references were rewritten. Existing single-column indexes with distinct workloads were retained; broader pruning needs workload measurements. Polymorphic message entity references remain application-managed.

The new invoice guard closes the creation-path ownership gap. Direct SQL and other write paths are still governed by the existing simple foreign keys; full database-enforced tenant consistency would need a separate composite-key design that accounts for shared vendors and global tax types.

Index ordering follows MySQL's documented [leftmost-prefix rules](https://dev.mysql.com/doc/refman/8.4/en/mysql-indexes.html). Deployment considerations follow its [online DDL documentation](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html) and [limitations](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-limitations.html).
