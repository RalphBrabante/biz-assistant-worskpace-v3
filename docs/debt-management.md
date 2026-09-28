# Debt management

Open **Operations → Debt management** and select an organization. Use **Add debt** to record a name, creditor/lender, original amount, debt date, optional due date, and notes. The currency is taken from the organization when the debt is created and stays with that debt.

Open a debt and record a payment with its amount, payment date, and optional receipt/transfer reference and notes. The page immediately updates total paid and remaining balance and retains a paginated payment history with the person who recorded each payment. A zero remaining balance is labeled **Fully paid**. Payments may be backdated to the debt date; every recorded payment counts toward the balance.

Remaining balance = original debt amount − recorded payments. Amounts use two decimal places. Zero/negative payments, invalid dates, dates before the debt, and overpayments are rejected. Each payment and its balance update commit together; locking the debt prevents concurrent overpayments. Request keys make retries safe after a lost response. If a save fails, retry the same form; reloading the history also shows whether it was recorded.

Search by debt name or creditor and filter outstanding or fully paid debts. Summary totals apply to the current filters and are grouped by currency. Debt amounts and payment records are retained as recorded; this version does not offer editing, interest schedules, or payment reversal. Authorized users can delete a debt and all its payments after confirmation. This is a debt ledger: adding a payment records an existing payment and does not initiate a bank transfer or create an expense entry.

## Access and deployment

Apply `20260926000000-create-debts.js` before starting the updated API. It adds `debts`, `debt_payments`, and three permissions:

| Permission | Access |
| --- | --- |
| `debts.read` | View debts, balances, summaries and payment history |
| `debts.create` | Add a debt |
| `debts.pay` | Record a payment against a debt |
| `debts.delete` | Delete a debt and its payment history |

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

## Inline payment history and overdue reminders

Click the chevron or debt name in any table row to expand its payment activity. Multiple debts can be expanded independently. Each history has its own pagination, refresh, loading and retry states; saving a payment refreshes expanded histories.

The API schedules an overdue digest daily at **08:00 Asia/Singapore (UTC+8, also Philippines time)**. Active organizations receive one email at their **contact email** listing debts with a due date before today and a remaining balance greater than zero. Paid debts, debts due today, and debts with no due date are excluded. Amounts retain each debt's currency.

Apply `20260928000000-create-debt-reminder-deliveries.js` before deploying. Configure `SMTP2GO_API_KEY`, `SMTP_FROM_EMAIL`, and `APP_BASE_URL` using the existing email settings. `DEBT_REMINDER_JOB_ENABLED=false` disables the job. Both NestJS and legacy API startup/shutdown manage the scheduler. The API must be running at 08:00; startup schedules the next 08:00, with no retroactive catch-up.

Daily delivery records survive restarts and a database transaction serializes competing API replicas. Failed sends are logged and not marked delivered; the next scheduled run tries again. As with most email providers, a crash after provider acceptance but before the database commit can result in a duplicate. No live emails are sent by the automated tests.

## Debt row actions

The leftmost Actions menu groups Show/Hide payments, View details, Record payment (for unpaid debts), and Delete debt. Delete requires `debts.delete` or the existing administrator/superuser bypass and asks for confirmation. Apply `20260928010000-add-debt-delete-permission.js` and assign the permission to staff who need it.

`DELETE /api/v1/debts/:id` uses the same organization scope as other debt endpoints. It locks the debt while deleting, and the database cascades deletion to all associated payment records. This permanently removes the debt from balances and future overdue reminders.
