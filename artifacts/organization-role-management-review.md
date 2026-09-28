# Organization role management review

Status: prepared and tested; authentication integration and the management screen have not been applied to the running application. Automatic approval review rejected the broader authentication changes. Approval is required to apply `organization-role-management.patch`.

## Available changes

The workspace contains the additive organization role models, API endpoints, module registration, and migration `20260928040000-create-organization-roles.js`. The three new tables have been created. Existing global role records and assignments were not migrated or rewritten. The new endpoint independently checks the actor's active membership and primary organization. Until the pending authentication integration is applied, organization-role assignments do not contribute effective permissions.

The pending patch adds `/organization-roles` with create/edit/disable/delete, permission selection, and member assignment. Its row actions are grouped on the left. Only an active administrator in their own organization can manage these roles; a superuser role alone does not grant this screen. Names and codes are unique within each organization. Reserved administrator codes, wildcard grants, and platform-only permissions cannot be assigned through organization roles. Global grants remain additive: removing an organization role does not revoke permissions granted through another role.

Legacy global roles and permissions remain readable where required for user creation, but editing global roles, permissions, and existing global assignments requires superuser access. Organization administrators retain the existing user-creation flow (excluding superuser assignment).

## Regression fixes included in the patch

- Effective permissions honor active roles, active assignments, active permissions, and the allowed/active state of global role-permission grants.
- HTTP authentication, login responses, and socket authentication use the same effective-role resolver.
- A primary-organization administrator does not inherit administrator privileges when signing into another organization as an ordinary member.
- Explicitly inactive organization membership cannot be bypassed through the primary organization fallback.
- Ordinary user updates cannot change the legacy role field; legacy role assignment routes are restricted.
- Reassigning an inactive legacy assignment reactivates it.
- System-role identity and status changes are rejected.
- UI requests are cancelled and role details cleared when organization/authentication context changes. Deletion confirmation cannot act on a subsequently selected organization.
- Two existing frontend test harnesses now mock the shared row-action component introduced by the earlier table-action work.

## Validation

All validation used the isolated source copy at `/tmp/organization-role-review`.

- Backend TypeScript build: passed.
- Angular development build: passed.
- Existing backend suite: 281 tests passed.
- Client suite including five new role-screen tests: 177 tests passed.
- MySQL integration harness: passed CRUD, uniqueness per organization, administrator-only access, cross-organization isolation, restricted grants, scoped member options, assignment idempotency, permission revocation/deactivation, inactive memberships and legacy grants, system-role protection, and global assignment route restrictions.
- `git apply --check artifacts/organization-role-management.patch`: passed against the current workspace.

The MySQL harness used only `role-test-mysql` / `role_test_review`; the disposable container and its volume were removed. No real users, roles, or permissions were modified by these tests. Browser-based visual testing and a live sign-in smoke test remain deployment checks after approval.

## Applying after approval

The patch is relative to the current workspace, including earlier uncommitted work. Check the before-file hashes in `organization-role-management-manifest.json` and rerun `git apply --check` before applying it. Do not apply it over intervening changes without reviewing conflicts. Apply the patch, build the API/client, restart the appropriate services, then smoke-test administrator and ordinary-member sessions in two organizations. The additive migration has already been applied in this environment; other environments need that migration before the authentication integration is enabled.

No destructive schema migration is required. Reverting the pending patch leaves the additive tables intact; do not drop them if users have created roles.
