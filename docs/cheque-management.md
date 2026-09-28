# Cheque management

Open **Cheque management** from the organization navigation (`/cheques`). Access follows bank management: administrators and superadmins only, with organization scoping enforced by the API.

Record the linked bank account, cheque number, payee, amount, issue date, cheque date, and optional payment reference/notes. Future cheque dates are supported. Issuing a cheque does not deduct or reserve the bank balance. Outstanding totals and a due-only filter show pending obligations; these do not represent spendable bank balances.

- **Clear:** after bank confirmation, record the clearance date. It must be on or after the cheque date and no later than today. The bank debit, operation record, and cheque status commit atomically. Insufficient funds or an archived account prevents clearance. Concurrent requests and retries cannot deduct twice.
- **Void:** cancel an issued cheque with a reason; no bank movement occurs.
- **Record bank return:** after a cleared payment is reversed by the bank, record the return date and reason. The original debit is retained and a linked credit restores the amount once. Returned cheques are final; issue a replacement if needed.

Issued details are retained for audit; void and replace incorrect cheques. Cheque numbers cannot be reused within the same bank account, including voided numbers. Dates and amounts are validated on the server, and fractional cents are rejected. Clearing and returns appear in bank transaction history. Generic bank reversal actions cannot reverse cheque entries; use the cheque action so status and balances remain consistent. Banks with outstanding issued cheques cannot be archived.

Cheques are a manual payment register. A payment reference can identify a bill, invoice, or debt, but this feature does not automatically settle those separate records or contact the bank. The cheque date alone never automatically clears a cheque.

## Validation and rollout

- Backend and Angular development builds passed.
- All 284 backend tests and 23 focused cheque/bank/shared UI tests passed.
- Disposable MySQL tests passed issue-without-deduction, exact decimal clearance, concurrent retries, competing insufficient-fund clearances, returned credits, voiding, date validation, duplicate numbers, tenant boundaries, staff rejection, archived-account restrictions, and persistence-failure rollback.
- The existing bank-ledger database regression also passed.
- The cheque route returned HTTP 200 after rollout. Authenticated browser interaction was not automated.
- Migration `20260928050000-create-cheques.js` adds the cheque table, indexes, and references. No existing bank balances or transactions were changed by rollout.
- The standard migration runner also applied the previously pending `20260924020000-add-ticket-conversations.js`: a nullable message envelope column and the ticket-attachment table/index. This was an additive migration; its source was not changed for this task.

Tests: `node --test tests/cheques.test.cjs tests/banks.test.cjs tests/ui-interactions.test.cjs` in the client. The API integration harness `node scripts/verify-cheques.js` requires an empty disposable `cheque_test` database on `cheque-test-mysql`, with `CHEQUE_TEST_HOST`, `CHEQUE_TEST_DATABASE`, and `CHEQUE_TEST_PASSWORD` set. It refuses other targets and nonempty databases.
