# Organization invitations and accountant access

Open **Organizations → organization → Invite user to this organization**, choose **ACCOUNTANT**, and send the invitation as the organization's administrator or a superuser. Enter the accountant's email; include first and last names for a new account. Invitations apply only to this organization. The same accountant can be invited separately to several organizations and select an organization during login.

Accountants can:

- Review and export expenses and sales invoices, including invoice previews and attachments.
- Review vendors, customers and tax/withholding types.
- Prepare, generate, preview and export quarterly and BIR reports, using the selected organization's tax profile.
- Manage their own profile and view accounting notifications.

Accountants cannot create, edit, delete, approve, pay or transfer transaction records; change organization settings, memberships or roles; delete reports; or access cheque/bank/voucher management, inventory, orders, debts, tickets, licenses or administration. These restrictions are enforced by the API as well as the navigation and action controls.

## Implementation and deployment

`OrganizationUser.role` selects an organization-scoped preset (administrator, standard end user, accountant or inventory manager). The general `/organizations/:id/invitations` endpoint and the existing add-user endpoint enforce administrator/superuser access and never create global role assignments. A global superuser role can only be granted through the separate global role administration workflow. Custom organization roles can be assigned separately through Organization roles. `accountant` is capped to record review and report preparation. Invitations do not create a global `UserRole`, overwrite an existing user's role, or change their primary organization/password. A verified active user receives a sign-in link; a new or unverified user receives an expiring password setup link. Failed delivery retains the membership and is reported visibly so the administrator can resend. An existing different membership role must be managed first rather than silently replaced by an invitation.

Login and session refresh calculate the same effective permissions for the token's organization. The selected membership determines the organization role; it cannot inherit global grants from another organization. An accountant membership caps all legacy write grants. Legacy global accountants without an explicit membership retain read-only access only to their primary organization. Global superusers retain platform administration. Active organization custom roles are also respected, subject to their existing restricted-resource policy.

The socket connection uses the token's organization and validates active membership. Accountants join a separate accounting notification room; inbox queries also filter unrelated entity types. Removing membership revokes access tokens for that organization, removes its custom role assignments, and disconnects its sockets. An inactive membership overrides the legacy primary-organization fallback.

Administrators can invite users only into the organization selected in their session; superusers can invite into any organization. Organization roles may differ across memberships. Select the organization during login to use that membership’s permissions. Existing users keep their account and primary organization when another membership is added.

Run `npm run db:migrate` in the API deployment. Migration `20261005020000-scope-accountant-permissions.js` adds `customers.read` and replaces historic global accountant write grants with the review/report preset. Its rollback deliberately retains the permission reduction and system permission rather than silently restoring broader access. Fresh databases receive the same grants through the RBAC seeder. Restart the API and serve the rebuilt client together so socket rooms and UI permissions are current. No production invitations are sent during automated tests; email delivery is mocked.

Verification: `node --test tests/accountant-access.test.js` in `api`, plus API/client production builds and the existing regression suites.
