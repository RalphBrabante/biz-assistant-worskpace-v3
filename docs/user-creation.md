# User creation failure handling

The previous controller returned `Unable to create user.` (HTTP 500) for all database/validation errors. It also saved the account before its membership and roles, so a later access-write failure could leave an account behind and make retries fail on the globally unique email address.

User creation now saves the account, primary organization membership and roles in one MySQL transaction. Membership/role failures roll back the account; invitation delivery starts after commit. Existing email addresses return HTTP 409 with an explicit message, including concurrent requests that race past the precheck. Sequelize validation errors return HTTP 400; text field limits are checked before writes and match the database/frontend (100-character names/city/state, 30-character phone, and existing address/email/postal limits). Unexpected failures still return a safe 500, and their server log records the error name/database code without SQL or bound passwords.

The create form ignores repeated submissions while pending. Once the API confirms an account is saved, the form closes even when invitation delivery failed, and the page shows that account creation succeeded but mail was not sent. Failed account creation preserves the form and shows the API message.

Local checks:

- `node --test api/tests/user-creation.test.js api/tests/create-references.test.js client/tests/user-creation.test.cjs` — controller/reference regressions and real Angular form validation.
- `RUN_USER_CREATION_MYSQL_INTEGRATION=1 node --test api/tests/user-creation-mysql.integration.cjs` — isolated local MySQL schema, actual password hashing, account/access persistence, duplicate-email races, rollback totals and successful retry. No application records or emails are used; the temporary schema/user are removed afterward.
- `npm run build --prefix api` and `npm run build --prefix client` — production compilation (Node 22).

These checks reproduce and fix failure paths locally. The exact cause of a failed request on `app.gimosupplies.com` requires its Hostinger application log (`Create user error`, error name and database code). No production deployment or migration is performed by this investigation.
