# Stock management

Products expose **Low-stock threshold** in both Add Item and Edit Item. Thresholds are non-negative whole numbers; stock supports three decimal places. A threshold of zero disables low-stock warnings while keeping out-of-stock warnings enabled. CSV import/export retains the existing `reorderLevel` column.

## Items table display (issue #5)

The Stock cell removes an all-zero decimal suffix from integral API values:
`0.000` → `0`, `1.0` → `1`, `25.00` → `25`. It operates on strings, without
numeric conversion, rounding, writes, or changes to ordering/pagination. Genuine
fractions such as `1.125` and floating-point artifacts remain visible unchanged;
the formatter cannot safely infer whether they should represent whole units.

The traced source of padded integral values is the `DECIMAL(12,3)` item stock
schema (`api/src/models/item.js` and the create-items migration), mysql2's default
DECIMAL-as-string parsing (no `decimalNumbers` override in the database config),
and `listItems` returning model rows unchanged. The previous template directly
interpolated that string. This trace and regression fixtures explain the display
case; they do not establish the contents of a production database.

Fractional values are also intentionally accepted by existing create/edit inputs
(`step="0.001"`), model validation (`validateInventory` allows three decimals),
CSV import, and three-decimal order quantities/calculations. This display patch
does not change that policy. Before enforcing whole-unit inventory, confirm:

- Whether integer-only validation applies to every item/unit type, API/import
  entry point and order quantity, or only discrete-unit products.
- How existing fractional stock and related order quantities should be handled
  (for example, retain and flag for manual reconciliation). No implicit rounding,
  automatic conversion, or historical data repair is authorized.

Focused checks:
`node --test client/tests/item-stock.test.cjs api/tests/items-stock-display.test.js`
from the repository root. They cover exact formatting, unchanged values/badges,
API `createdAt DESC` ordering, and forward/back client pagination. The Items
table has no user-selectable sorting control; the existing API order is retained.

Visual acceptance remains outstanding as of 2026-09-30: the managed browser
started, but navigation to the local application was rejected with
`browser navigation blocked by policy`. No workaround or policy change was
attempted. In a permitted local/test environment, load the actual Items table
with synthetic `0.000`, `1.000`, `25.000`, and `1.125` rows; inspect badges and
stock text, change page size, use Next/Prev, and confirm server row order is
preserved. Capture screenshots and the test fixture/API responses. Do not treat
the automated checks as a substitute for this visual gate or as production-data
verification.

## Inventory behavior

Managed orders deduct product quantities once at confirmation with inventory enabled. Drafts, fulfillment, invoicing, payments, and financial refunds do not deduct again. Eligible cancellation restores committed quantities once. Services do not consume stock. Orders and product rows are locked during confirmation to prevent competing orders from overselling.

Active products generate organization-wide in-app notifications when they become low (positive stock at or below the threshold) or out of stock (zero). Everyone in the organization, including the actor, receives the broadcast; messages remain available in the organization's shared notification inbox. These are in-app notifications, not emails. Repeated writes within the same stock state do not repeat alerts. Restocking above the threshold permits another alert on the next crossing. Threshold edits, item creation/import, and reactivation also evaluate stock state.

Stock warnings persist in the inventory transaction; socket broadcasts happen after commit. Notification persistence failure rolls back transactional stock updates. Services and inactive items do not generate stock warnings.

`node scripts/backfill-stock-alerts.js` previews initial warnings for existing products. `--apply` creates missing first warnings, locking each item and skipping items with an existing stock alert. The rollout created one initial warning; a second preview found no remaining eligible items.

Validation: API and Angular development builds passed; 284 backend tests and 9 targeted UI tests passed. The disposable MySQL suite verified alert transitions, threshold changes, rollback, persistence failures and fractional balances. The full order integration suite verified concurrency, confirmation retry protection, cancellation, fulfillment, invoicing, payment/refund behavior and tenant isolation. Real customer orders and stock quantities were not modified by the tests.

Regression commands:

- `node --test tests/stock-alerts.test.js` (API)
- `node --test tests/item-stock.test.cjs tests/ui-interactions.test.cjs` (client)
- `node scripts/verify-stock.js` requires an empty disposable database at `stock-test-mysql`, named `stock_test`. It refuses other database targets and initializes only that test schema.
- After that initialization, run `node tests/order-workflow.integration.cjs` with the same disposable database environment.

The legacy stock deduction helper was also corrected to preserve three decimal places instead of rounding balances down to whole units. Existing historical stock balances are not automatically reconstructed.
