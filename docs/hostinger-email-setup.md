# Configure a Hostinger mailbox for each organization

Mailbox addresses and passwords are entered **in the frontend**, independently for each organization. No mailbox address is hardcoded, and no organization mailbox password belongs in the deployment environment.

## Organization administrator workflow

1. Sign in and select the organization whose email tickets you want to manage. Ordinary administrators are already scoped to their own organization; superusers must select a specific organization.
2. Open **Email tickets → Connect Hostinger**.
3. Choose **Hostinger Email**. Choose **Titan Email through Hostinger** only if that is the product shown in your Hostinger hPanel.
4. Enter this organization's mailbox address, for example `sales@gimosupplies.com` for Gimo Supplies. Other organizations enter their own addresses.
5. Enter the **mailbox password**, not your Hostinger account password. Enter it only in the app's password field over HTTPS; it is never shown again by the application.
6. Click **Test and connect**. The app verifies both IMAP and SMTP authentication before saving; this test does not send an email.
7. Click **Sync now** and then **Refresh**, or wait for the automatic one-minute sync cycle.

Use **Configure mailbox** to update the saved password if it changes in Hostinger. **Disconnect** removes the saved credential and stops importing/sending while preserving tickets and private notes.

A mailbox can belong to only one organization, and this version supports one connected mailbox per organization (Hostinger, Titan, or Gmail). An existing mailbox's address/provider is retained to preserve ticket identity; reconnect it with a new password rather than replacing it with an unrelated account. Historical mailbox replacement or multiple inboxes per organization is not included.

## Organization isolation and access

- Every connection, sync operation, ticket, customer link, and assignee belongs to an organization.
- Organization administrators cannot select another organization by altering frontend requests.
- The same email Message-ID in two different organizations creates separate records; reply references cannot join tickets across organizations.
- Only administrators and superusers configure, update credentials, or disconnect mailboxes.
- Give agents `tickets.read`, `tickets.manage`, and optionally `tickets.reply` in Roles. Connecting a mailbox makes its imported messages visible to members with ticket read permission, not just the assignee.

See the [ticket workflow guide](email-tickets-setup.md) for assignments, priorities, statuses, notes, and filters.

## One-time deployment setup

A deployment administrator must install the updated dependencies and run both ticket migrations:

```bash
cd api
npm ci
npm run db:migrate
npm run build
```

Then rebuild/deploy the frontend using your normal deployment process. Docker development can run `docker compose exec biz-assitant-api npm run db:migrate` after dependencies are installed.

Set a **single server encryption key**, which protects every organization's separately stored password:

```dotenv
EMAIL_TICKET_ENCRYPTION_KEY=replace-with-64-hex-characters
EMAIL_TICKET_SYNC_ENABLED=true
```

Generate the key privately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The key is infrastructure configuration, not an organization's mailbox configuration. Keep it stable, backed up securely, and identical on every API instance. Passwords are encrypted using AES-256-GCM and are never included in API responses, browser storage, or provider logs. Losing the key requires each organization to reconnect. Existing installations may use `GMAIL_TOKEN_ENCRYPTION_KEY` as a fallback; if doing so, keep that value stable when configuring the new key.

Recreate the API container after changing environment settings. The base, production, and staging Compose files pass these variables through. Hostinger-hosted Node deployments should set them in their application environment. No Google Cloud client ID, OAuth consent, Gmail account, or mail forwarding is required for Hostinger connections.

The API needs outbound TLS access to IMAP port **993** and SMTP port **465**. The app fixes the endpoints according to the selected provider:

| Provider | Incoming IMAP | Outgoing SMTP |
| --- | --- | --- |
| Hostinger Email | `imap.hostinger.com:993` | `smtp.hostinger.com:465` |
| Titan Email | `imap.titan.email:993` | `smtp.titan.email:465` |

Both use TLS with certificate validation. The username is the complete mailbox email address. Confirm the product/account details in hPanel; [Hostinger's configuration guide](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/) and [Titan's configuration guide](https://www.hostinger.com/support/4299903-how-to-set-up-titan-email-on-your-devices-and-email-applications/) list the official settings.

## What sync imports

- Initial import covers messages from the last 30 days in **Inbox** and the detected **Sent** folder. Other folders and archived mail are not scanned by this version.
- Each cycle imports up to 25 messages per folder, then saves IMAP UID/UIDVALIDITY checkpoints. Larger mailboxes finish in batches.
- Messages are read without marking them read or removing them from the mail server.
- Message-ID prevents duplicate imports; In-Reply-To and References group replies into the same ticket. A matching subject alone does not join tickets.
- Sent-only conversations do not create new support tickets. Replies in Sent are added when a corresponding ticket can be found.
- Customer matching, assignment, priorities, private notes, and reopening work as described in the main ticket guide.
- Email bodies are displayed as text, including text extracted from HTML-only messages. Attachments are listed by name; open webmail to view/download them.
- Messages larger than 10 MB create an entry with sender, subject, and thread headers plus a notice to open webmail. Bodies are limited to 200,000 characters.

Replies are submitted through the organization's SMTP account. The app also tries to save a Sent-folder copy. A failed Sent-folder copy does **not** trigger a resend. “Sent” means SMTP accepted the message; later delivery failures/bounces can still occur.

If delivery is marked **sending** or **unknown** after a timeout, check the webmail Sent folder and the recipient before sending again. Where a Sent copy is available, sync reconciles it against the saved Message-ID. The app never automatically retries an uncertain send.

## Troubleshooting

- **Encryption storage is not configured:** set the one-time encryption key on the API and restart/recreate it. Each organization then configures its own mailbox in the frontend.
- **Test and connect fails:** check the complete email address, mailbox password, provider selection, account status and third-party mail access in hPanel. Confirm outbound IMAP/SMTP traffic is permitted by your application host.
- **Connected but no new tickets:** select the correct organization, check the last sync/error, and use Sync now followed by Refresh. Check that qualifying messages are in Inbox, not only another folder.
- **Password changed:** open Configure mailbox and test/save the new password.
- **Cannot connect the same address elsewhere:** an organization already owns this mailbox. This prevents two organizations from sharing ticket data accidentally.
- **Reply accepted but no Sent copy:** do not resend; verify delivery and the mailbox's Sent folder configuration.

## Validation

```bash
# Inside api/
node --test tests/email-tickets.test.js tests/hostinger-tickets.test.js
node scripts/verify-email-tickets.js
```

The MySQL verification uses fixtures that are rolled back and never sends mail. Live credential verification, IMAP import, and SMTP delivery require an organization administrator to connect a real mailbox using the frontend form.
