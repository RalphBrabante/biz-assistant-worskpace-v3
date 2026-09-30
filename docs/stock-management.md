# Stock management

Products expose **Low-stock threshold** in both Add Item and Edit Item. Stock and thresholds must be non-negative whole numbers. Stock is limited to 999999999 units. Item creation, edits, and CSV imports reject fractional stock through model validation. The Items table removes database decimal padding (for example, `17472.000` displays as `17,472`). Existing stored balances are not changed or rounded; historical fractions remain visible until explicitly corrected. A threshold of zero disables low-stock warnings while keeping out-of-stock warnings enabled. CSV import/export retains the existing `reorderLevel` column.

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
