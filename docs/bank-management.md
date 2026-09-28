# Bank account management

Open **Operations → Bank management**, select an organization, then **Add bank**. Enter a nickname, bank name, optional last four account digits, opening balance and date, and notes. The currency is copied from the organization and remains fixed for the account. Opening balances must be nonnegative; the ledger supports two decimal places.

This is a manual ledger. Recording entries does not initiate bank transfers or synchronize with banks, debts, expenses, or invoices. Enter completed bank activity once, using its statement reference. Do not enter passwords, PINs, or full account numbers.

## Accounts and transactions

- Balances and active-account totals, grouped by currency.
- Search by nickname, bank name, or last four digits; archived accounts are hidden by default.
- The leftmost Actions menu offers transaction history, deposits, withdrawals, transfers, and account editing/archiving.
- Transfers require two active accounts within the same organization and currency. Both sides commit together.
- Withdrawals, transfers, and reversals cannot make a balance negative. Overdrafts and currency conversion are not supported.
- Transaction history includes statement date, recorded time, reference, notes, author, and balance after posting. Filter by type/date and paginate; **Export page CSV** downloads the currently displayed page.
- Backdated entries are accepted and affect the current balance immediately. Balance-after-posting reflects the order recorded, not a reconstructed historical statement balance. Future dates are rejected. Date validation uses Singapore/Philippines time (UTC+8).
- Reverse a transaction to correct a mistake. A reason is required; both sides of a transfer reverse together. Original entries remain visible and are labeled reversed. Opening balances and reversal entries cannot themselves be reversed; use correcting deposits or withdrawals for opening-balance corrections.
- Accounts with a zero balance can be archived and restored. History is retained; accounts and posted entries are not deleted or edited.

## Permissions and deployment

Apply `20260928020000-create-bank-ledger.js`. Both NestJS and legacy Express expose the feature. Permissions are `banks.read` (accounts/history), `banks.manage` (add/edit/archive), and `banks.transact` (deposit/withdraw/transfer/reverse). Access is currently restricted to the built-in `administrator` and `superuser` roles (admin and superadmin). Staff cannot access bank data even if assigned all `banks.*` permissions. The navigation, route guard, page controls, and every bank API endpoint enforce this restriction. Existing administrator/superuser permission bypass applies; all requests remain scoped to the authenticated organization, or the explicit selected organization for superusers.

All balance changes use integer minor-unit arithmetic and a database transaction. Organization/account locks serialize concurrent writes, paired transfer entries commit together, and organization-scoped request keys prevent duplicate postings when a response is lost. Retry the same form after a network error. Changing its content after a possibly successful request produces a conflict; check the history before reopening a form.

Endpoints under `/api/v1/banks`:

- `GET /`, `POST /`: list accounts/totals or create an account and opening entry.
- `PUT /:id`: edit account metadata/archive status, without changing its balance or currency.
- `GET /:id/transactions`: paginated history (`page`, `kind`, `from`, `to`).
- `POST /transactions`: record `deposit`, `withdrawal`, or `transfer` with a UUID-v4 `requestKey`.
- `POST /transactions/:operationId/reverse`: reverse with a reason and UUID-v4 `requestKey`.

## Verification

Run `npm run test:banks` within `api` and `client`. `api/scripts/verify-banks.js` performs integration checks for the migration, balances, concurrency, idempotency, rollback, scope isolation, reversals, account lifecycle, history, and amount/date validation. It refuses a nonempty database and requires `BANK_TEST_DATABASE=bank_test_*`, `BANK_TEST_HOST=bank-test-*`, and `BANK_TEST_PASSWORD`; run only against a disposable MySQL container on the API's Docker network, then remove that container and its volume.
