# Expense transfer calculations

Transfers preserve the receipt's gross amount, supplier VAT, VAT-exempt portion, discounts, and service charge. The shared integer-cent calculator derives destination input VAT, withholding base, withholding tax, and payable using the destination organization's configured tax type and withholding settings. A destination's VAT rate does not rewrite the supplier VAT on an existing receipt.

Withholding IDs belong to an organization. Transfers match a source withholding **code** to a unique active destination expense/both code. Missing or ambiguous matches require an explicit destination selection or None. The destination percentage and minimum base apply, including the threshold boundary. A receipt with no withholding type but a nonzero recorded withholding also requires a choice.

Legacy VAT receipts can recover supplier VAT from their recorded VAT amount. A legacy non-VAT receipt without `receiptVatAmount` requires the actual VAT amount from the receipt (zero is valid); percentage tax is never reused as supplier VAT. Different currencies are rejected because this feature does not perform exchange-rate conversion.

## API contract

1. `GET /api/v1/expenses/:id/transfer-preview?targetOrganizationId=...` returns available destination withholding types, required selections, calculated amounts, and a `previewToken` when ready. This endpoint is uncached and does not write vendor links or financial records.
2. Resolve missing selections by requesting another preview with `withholdingTaxTypeId` (empty means None) and, for missing legacy splits, `receiptVatAmount`.
3. `POST /api/v1/expenses/:id/transfer` sends `targetOrganizationId`, the reviewed `withholdingTaxTypeId`, `receiptVatAmount`, and `previewToken`. The server recalculates from stored data and configured settings. Client-supplied totals are not trusted.

A missing/stale preview returns 409 and requires a fresh review. The fingerprint covers the source expense, destination tax settings, selected withholding rate/threshold, and calculated amounts. It is a concurrency check, not an authorization credential; permissions are checked on both requests.

The expense, vendor link, and affected existing quarterly expense reports save in one READ COMMITTED transaction. Both organizations' saved reports containing the expense date refresh from SQL DECIMAL sums, excluding cancelled expenses. Existing report IDs and notes are retained; generated time/user are updated. No new reports are automatically created. Organization locks are ordered and shared with explicit report regeneration. Notifications happen after commit. A stale expense edit cannot overwrite a concurrently transferred expense.

This change does not retrospectively rewrite historical expenses or determine whether a receipt legally belongs to another organization. Classification, receipt facts, and configured rates must be correct before confirmation.

## Verification

- API: `cd api && npm run test:expenses`
- Client: `node --test client/tests/expense-transfer.test.cjs client/tests/expense-calculation.test.cjs`
- MySQL integration: `cd api && npm run test:expenses:mysql`

The MySQL script requires a local test database account with CREATE/DROP DATABASE privileges. It creates a uniquely named `schema_review_test_transfer_*` schema, copies table **definitions only**, inserts synthetic fixtures, and removes that schema in `finally`. It never copies or updates business rows. It exercises actual controller/model transactions, VAT/non-VAT round trips, report aggregation, rollback after an injected report failure, stale previews, duplicate numbers, concurrent transfers in both directions, concurrent report generation, stale edits, permissions, and currency mismatch.
