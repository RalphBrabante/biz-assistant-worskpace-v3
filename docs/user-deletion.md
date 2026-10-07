# Deactivate before deleting a user

An account can be deleted only after its persisted `isActive` flag is false. Its status (including `suspended`) and its organization membership status do not replace account deactivation.

In Users, a superuser selects **Deactivate** and confirms. After the refreshed list shows **Active: No**, **Delete** becomes available and requires a separate confirmation. Alternatively, a superuser opens User Details, clears **Active**, and saves. Other authorized users can delete a deactivated account within their existing organization scope; only superusers can change account activation, as before.

`DELETE /api/v1/users/:id` still requires `users.delete`. It returns HTTP 409 with `Deactivate this user before deleting the account.` for an active account. The API checks the stored flag under a transaction row lock and deletes within that transaction, preventing reactivation from racing the check. Profile file cleanup runs only after the transaction commits.

Local regression checks: `node --test api/tests/user-deletion.test.js client/tests/user-deletion.test.cjs`. These use controller/component fixtures; production deployment and authenticated production verification are separate steps. No migration is required.
