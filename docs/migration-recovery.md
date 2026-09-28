# Recovery from interrupted ledger migrations

A deployment reporting `Duplicate key name 'bank_accounts_org_status'` has already created that index, while the bank-ledger migration is still pending in SequelizeMeta. MySQL/MariaDB DDL commits independently of the migration metadata, so restarting the original unconditional index creation repeats the error.

The bank-ledger, organization-role, cheque, and voucher migrations now inspect named indexes before adding them. Matching columns, uniqueness, prefix length and sort direction are verified. Completed indexes are reused and missing indexes are created. A conflicting definition or unrelated SQL error still stops the migration with an actionable error. No existing indexes or business data are deleted by this fix.

Rebuild and redeploy the updated application with the normal migration startup setting enabled. The production runner uses `api/dist/migrations`, so restarting an old build is insufficient. Leave the existing tables and SequelizeMeta intact; do not drop the bank tables or manually mark unfinished migrations complete. The migration runner will record completion after the remaining migration steps succeed.

Validation: API build and 289 backend tests passed. `api/scripts/verify-migration-resume.js` reproduced the duplicate key in a disposable MySQL database, resumed partial migrations using the compiled production files, repeated completed migrations, verified preserved account balances/ledger entries/permission IDs, and checked that incompatible indexes are rejected without replacement. No production database was accessed during verification.

The harness requires an empty `migration_test` database on `migration-test-mysql` and `MIGRATION_TEST_HOST`, `MIGRATION_TEST_DATABASE`, and `MIGRATION_TEST_PASSWORD`. Set `MIGRATION_TEST_COMPILED=true` after building to test the deployed artifacts.
