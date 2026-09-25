# Debt management

Open **Operations → Debt management** and select an organization. Use **Add debt** to record a name, creditor/lender, original amount, debt date, optional due date, and notes. The currency is taken from the organization when the debt is created and stays with that debt.

Open a debt and record a payment with its amount, payment date, and optional receipt/transfer reference and notes. The page immediately updates total paid and remaining balance and retains a paginated payment history with the person who recorded each payment. A zero remaining balance is labeled **Fully paid**. Payments may be backdated to the debt date; every recorded payment counts toward the balance.

Remaining balance = original debt amount − recorded payments. Amounts use two decimal places. Zero/negative payments, invalid dates, dates before the debt, and overpayments are rejected. Each payment and its balance update commit together; locking the debt prevents concurrent overpayments. Request keys make retries safe after a lost response. If a save fails, retry the same form; reloading the history also shows whether it was recorded.

Search by debt name or creditor and filter outstanding or fully paid debts. Summary totals apply to the current filters and are grouped by currency. Debt amounts and payment records are retained as recorded; this version does not offer editing, deletion, interest schedules, or payment reversal. This is a debt ledger: adding a payment records an existing payment and does not initiate a bank transfer or create an expense entry.

## Access and deployment

Apply `20260926000000-create-debts.js` before starting the updated API. It adds `debts`, `debt_payments`, and three permissions:

| Permission | Access |
| --- | --- |
| `debts.read` | View debts, balances, summaries and payment history |
| `debts.create` | Add a debt |
| `debts.pay` | Record a payment against a debt |

Administrators/superusers retain their existing permission bypass. Assign the appropriate permissions in Roles for other staff; include read access for anyone using the page. Administrators and staff are confined to their authenticated organization. Superusers must choose a specific organization. Balance/history reads bypass response caching.

Both the NestJS deployment and legacy Express API expose:

- `GET /api/v1/debts` — filtered list, pagination and summary by currency.
- `POST /api/v1/debts` — create, with a UUID v4 `requestKey`.
- `GET /api/v1/debts/:id?page=1` — debt and paginated payment history.
- `POST /api/v1/debts/:id/payments` — record payment, with a UUID v4 `requestKey`.

Superuser requests include `organizationId` in the query. Client-provided balance, currency, organization and author values cannot override the server's payment calculation or ownership.

## Validation

```bash
node --test api/tests/debts.test.js client/tests/debts.test.cjs
```

`api/scripts/verify-debts.js` verifies the migration and payment operations on real MySQL. It only accepts an empty disposable localhost database named `debt_test_*`, using `DEBT_TEST_DATABASE`, `DEBT_TEST_PORT`, and `DEBT_TEST_PASSWORD`. It ignores the application's `DB_*` configuration. Run it against an isolated MySQL container and remove that container afterward. The checks cover decimal arithmetic, competing payments, duplicate requests, rollback, history joins, status filters and aggregate totals.
