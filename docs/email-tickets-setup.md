# Email tickets and Gmail setup

For Hostinger or Titan mailboxes, use the [organization mailbox setup guide](hostinger-email-setup.md). Each organization configures its own email address and password in **Email tickets → Connect Hostinger**. The Gmail instructions below apply only when you choose Gmail.

## What is included

Open **Email tickets** in the sidebar after selecting an organization. Tickets support:

- Assignment to an active user in the same organization, including secondary organization memberships.
- Linking to an existing customer, with filters for customer, teammate, assigned to me, and unassigned.
- Open, Pending, Resolved, and Closed statuses; Low, Normal, High, and Urgent priorities; optional due dates and an overdue filter.
- Search by subject or requester address; sorting by latest conversation, oldest ticket, priority, or due date; paginated lists and conversation history.
- Private team notes, an activity history for changes to ticket details, and protection against overwriting another teammate's changes.
- Manual internal tickets and Gmail email threads imported as tickets.
- Reply or reply-all to a selected email, with To/Cc preview, threading headers, attachments, delivery status, and duplicate-request protection.
- Attachment downloads and image previews inside the conversation; earlier messages and optional ticket activity history.

Each organization has one connected mailbox. The following import behavior describes Gmail; Hostinger behavior is documented in its separate guide. Use a dedicated support address: imported conversations are available to organization members granted ticket access. Initial import scans threads with activity in the last **30 days**, including archived mail; spam, trash, and drafts are excluded. Full conversation history in each matching thread is imported. Threads containing only sent messages do not create new tickets.

New tickets automatically link to a customer only when exactly one active customer in the organization matches the requester's email. Set the customer's email in Customers first. If there are multiple matches, choose the customer manually. Matching uses Reply-To when present, otherwise From. Customer links do not change the email reply recipient.

New inbound messages reopen Pending, Resolved, and Closed tickets. Existing assignment and customer links are preserved.

## Conversations, replies and files

Open a ticket to read its chronological email and note history. **Load earlier messages** pages older history; **Show ticket updates in history** toggles status/assignment activity. Each email has **Reply** and **Reply all** controls. The composer shows the selected email and the exact To/Cc recipients before sending. Reply respects that message's Reply-To (or From); reply-all also includes its visible To/Cc recipients, deduplicated, excluding the connected mailbox. Replies to sent messages use their original recipients. Selecting a different customer does not change recipients.

Threading retains the parent Message-ID and References chain. Gmail also receives the original thread ID and matching subject, following its [threading requirements](https://developers.google.com/workspace/gmail/api/guides/threads). Hostinger/Titan use the same headers through SMTP. Unrelated messages are never grouped by subject alone.

Attach up to **10 files totaling 10 MiB** per email reply. Files are stored with the outgoing message before delivery. Private notes do not send attachments. Downloads require ticket read access and verify the organization, ticket, message, and attachment IDs. File content is excluded from conversation responses and never exposed under public `/uploads` URLs. Downloads use attachment disposition; sender HTML and remote images are not rendered.

Imported Hostinger files and sent attachments live in `ticket_attachments` in MySQL, so include this table in database backups and capacity planning. Gmail attachment bodies are downloaded through the authenticated [Gmail attachment endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get) when needed; the original message and connected mailbox must remain available. Individual downloads are limited to 10 MiB. Hostinger's existing 10 MiB whole-email import limit still applies, including MIME encoding overhead; larger emails remain accessible in webmail.

For messages imported before this release, use **Load email details and attachments** on the message. Gmail retrieves the original by its saved ID; Hostinger/Titan searches Inbox and Sent by Message-ID. Deleted/moved originals or oversized IMAP emails may require webmail. Reply-all stays unavailable until the original recipient metadata has been retrieved.

If delivery is uncertain, the draft and files stay in the composer. **Check delivery** reuses the same request key; it does not create a second send intent. Sync can reconcile a matching Sent message. SMTP acceptance with a failed Sent-folder copy or partially rejected recipients is displayed as a warning; do not resend to everyone. A confirmed failed send preserves the draft for a deliberate retry.

## 1. Install the feature

Use the project's supported Node 22 runtime and normal deployment process. Apply migrations before starting the updated API:

```bash
cd api
npm run db:migrate
npm run build
```

Build the client using the normal project build command. For the Docker development stack:

```bash
docker compose exec biz-assitant-api npm run db:migrate
```

The initial migration is `20260924000000-create-email-tickets.js`. It adds `email_tickets`, `ticket_messages`, `gmail_mailboxes`, `gmail_oauth_states`, and three ticket permissions. It does not import email until you connect a mailbox. Existing customer records are reused. Apply `20260924020000-add-ticket-conversations.js` for recipient/thread metadata and the private `ticket_attachments` table before deploying the conversation UI.

For Hostinger, configure the environment variables below in the server environment and redeploy using the existing [Hostinger deployment guide](../README-HOSTINGER.md). For Docker, the base, production, and staging Compose definitions pass these variables to the API. Recreate the API container after changing environment variables; a process restart alone does not change a container's environment.

## 2. Give teammates access

Administrators and superusers already have access. In **Roles**, grant an appropriate role:

| Permission | Allows |
| --- | --- |
| `tickets.read` | See the organization's ticket list, messages, mailbox status, and assignment/customer choices |
| `tickets.manage` | Create internal tickets, edit status/priority/assignment/customer/due date, add private notes, and request Gmail sync |
| `tickets.reply` | Send email replies through the organization's connected mailbox |

For support agents, grant all three. For viewers, grant only `tickets.read`. Editing and replying do not imply read access, so include `tickets.read` for any role using this screen. Users may need to sign out and back in to refresh their navigation permissions.

Only administrators and superusers can connect, reconnect, or disconnect Gmail. Superusers must select a specific organization. Credentials are never returned to the browser. These permissions expose the shared inbox to the role; tickets are not restricted to their assignee.

## 3. Create Google OAuth credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create the project for this application.
2. Enable **Gmail API** under APIs & Services.
3. Configure the **Google Auth Platform / OAuth consent** branding, support email, audience, and data access. For an eligible Google Workspace organization, use an Internal audience if all connecting accounts belong to it. Otherwise use External; while testing, add the intended mailbox owner as a test user.
4. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
5. Create an OAuth client of type **Web application**.
6. Add this exact authorized redirect URI, replacing the example host:

   ```text
   https://your-app.example.com/api/v1/tickets/gmail/callback
   ```

   Local development can use `http://localhost/api/v1/tickets/gmail/callback` if that is where your application is served. Include any nonstandard port. Redirect URLs must match exactly.
7. Copy the client ID and client secret to the server environment. Do not put these values in client code or commit them to Git.

Google classifies `gmail.readonly` as restricted and `gmail.send` as sensitive. An external production app may require OAuth verification and, when restricted data is stored on your servers, a security assessment unless an exemption applies. Review Google's requirements for your audience before production rollout. External apps left in Testing commonly receive refresh tokens that expire after seven days for these scopes. [Google's scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth web-server setup](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## 4. Configure the server

```dotenv
APP_BASE_URL=https://your-app.example.com
GMAIL_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REDIRECT_URI=https://your-app.example.com/api/v1/tickets/gmail/callback
GMAIL_TOKEN_ENCRYPTION_KEY=your-64-character-hex-key
GMAIL_SYNC_ENABLED=true
```

`GMAIL_REDIRECT_URI` is optional; its default is `APP_BASE_URL` plus `/api/v1/tickets/gmail/callback`.

Generate the encryption key once, privately:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep the key stable, backed up with your secrets, and identical across API instances. Gmail refresh tokens are encrypted with AES-256-GCM. Losing or changing the key requires reconnecting every mailbox. The token key is separate from your Google client secret and existing Google Drive storage configuration.

The API needs outbound HTTPS access to `accounts.google.com`, `oauth2.googleapis.com`, and `gmail.googleapis.com`. Use HTTPS on the public app. Configure reverse-proxy/access logs to omit query strings on the OAuth callback; the application request logger already omits its code/state query parameters.

The background worker runs within the API process every minute. The API must stay running for automatic imports. Setting `GMAIL_SYNC_ENABLED=false` disables scheduled import; **Sync now** remains available. Requests to Google time out after 15 seconds; a later sync retries failed imports. Message IDs prevent duplicate imports.

## 5. Connect and check the mailbox

1. Sign in as an organization administrator and open **Email tickets** in the correct organization.
2. Select **Connect Gmail**, choose the support mailbox, and grant both requested permissions.
3. After returning to the app, select **Sync now**, then **Refresh** after a short wait. Automatic polling also imports messages.
4. Check the mailbox's last complete sync time. Large mailboxes import in batches of 20 threads per sync; the page shows when more batches remain.
5. Send a test email to the support mailbox from an account you control. Confirm it becomes a ticket, assign a teammate, and link a customer.
6. Add a private note and verify it stays inside the app. Select **Email reply**, review the recipient, and send a test response. Check the receiving inbox and Gmail Sent.
7. Resolve the ticket, reply from the test customer account, and confirm the next import reopens it.

The integration works with a Gmail account or a Google Workspace mailbox whose administrator permits this OAuth application. It connects a mailbox, not a Google Group. No Gmail plugin for the coding assistant is needed.

## Daily workflow

Use **Unassigned** to triage new requests, set priority and due date, assign a teammate, and link the customer. Use **Assigned to me** for individual queues or choose a customer to view their requests. **Pending** means waiting for the customer; **Resolved** and **Closed** finish the request until another customer message arrives.

Private notes and email replies have separate controls. The reply recipient is shown before sending. A customer link organizes the record and does not redirect replies to a different address.

If another user or Gmail sync changes a ticket while you edit it, reload the ticket and reapply your change. Ticket detail changes appear in the conversation activity history with their author.

## Troubleshooting and limits

- **Connect Gmail is disabled:** check the client ID, secret, APP_BASE_URL, and 64-character encryption key in the actual API environment, then restart/recreate the service.
- **redirect_uri_mismatch:** compare the configured redirect URL with Google Cloud, including scheme, host, port, path, and trailing slash.
- **Access blocked / unverified app:** add the mailbox owner as a test user, check the configured audience and Workspace administrator restrictions, or complete the required production verification.
- **Expired authorization:** reconnect the same mailbox. Testing-mode tokens and revoked grants can expire.
- **No imported mail:** check the selected organization, last sync/error, Gmail API enablement, and whether qualifying mail exists in the initial 30-day window. Use Sync now and then Refresh.
- **Partial import:** let subsequent cycles finish. The cursor is stored in the database and survives restarts. A successful cycle uses a five-minute overlap to catch recent delivery while deduplicating messages.
- **Reply shows sending/unknown:** an interrupted request can leave delivery uncertain. Check Gmail Sent before composing another reply. Retrying the same request key never sends twice; sync reconciles sent messages using their Message-ID. The app does not automatically resend uncertain messages.
- **Disconnect:** removes the stored refresh token and stops sending/importing; tickets remain. To revoke Google's grant too, remove the app from your Google Account's third-party connections. Reconnection must use the same email address to preserve thread identity. Moving/replacing mailboxes is not supported by this version.
- **Rendering and attachments:** conversations show plain text; HTML-only Gmail messages use its text preview. Files can be downloaded and PNG/JPEG/GIF/WebP images previewed. Reply-all retains To/Cc and excludes the connected mailbox and Bcc. Rich text, arbitrary recipient editing, Bcc sending, and Gmail label management are not implemented.
- **Manual tickets:** support internal tracking and notes; email replies are available only on imported email conversations.
- **Retention:** imported messages remain in the application even if the original email is removed in Gmail. Restrict database access/backups and apply your organization's retention process. There is no automatic ticket deletion in this version.

Synchronization uses Gmail thread listing with a persisted time window and page cursor, rather than Pub/Sub push or Gmail history IDs. Large mailboxes may take several cycles, and this is not an instant-delivery SLA. [Google's thread documentation](https://developers.google.com/workspace/gmail/api/guides/threads) describes thread grouping and reply requirements.

## Verification

```bash
# Inside api/ (with dependencies installed)
node --test tests/email-tickets.test.js
npm run build
# Optional real-MySQL checks, after applying the migration; fixtures roll back
node scripts/verify-email-tickets.js

# From the repository root
NG_BUILD_MAX_WORKERS=2 npm run build --prefix client -- --progress=false
```

Automated tests cover organization isolation, membership/customer assignment, permission separation, stale edits, repeat reply requests, OAuth expiration/replay, encrypted credentials, MIME safety, duplicate imports, customer-match ambiguity, and ticket reopening. Google consent and actual email delivery require your own configured Google Cloud client and mailbox; run the mailbox checks above before rollout.
