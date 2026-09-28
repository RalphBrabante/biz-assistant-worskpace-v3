# Quarterly tax filing reminders

The API emails active organization administrators at **08:00 Singapore/Philippines time (UTC+8)**, 15 calendar days after each calendar quarter ends:

| Quarter | End date | Reminder |
| --- | --- | --- |
| Q1 | March 31 | April 15 |
| Q2 | June 30 | July 15 |
| Q3 | September 30 | October 15 |
| Q4 | December 31 | January 15 of the next year |

Emails name the organization and reporting quarter, remind administrators to review reports and file applicable taxes, and include an **Open Reports** link built from `APP_BASE_URL` plus `/reports`. Recipients sign in and select the named organization and quarter. The timing is an internal reminder schedule, not a calculated statutory filing deadline; fiscal-year calendars are not used.

Recipients must be active users with active status in an active organization, with an active membership or a primary organization where no membership record exists. Explicitly inactive memberships are excluded. Administrator access may come from the user's legacy `role`, organization membership role, or an active `administrator` role assignment. Unrelated global superusers and ordinary staff do not receive these emails. Duplicate email addresses are normalized and collapsed per organization.

Apply `20260928030000-create-quarterly-tax-reminders.js` before deployment. The job starts and stops with both NestJS and legacy Express. `QUARTERLY_TAX_REMINDER_JOB_ENABLED=false` disables it. Configure `SMTP2GO_API_KEY`, `SMTP_FROM_EMAIL`, and `APP_BASE_URL` using the existing email service settings.

The process checks the clock each minute, sends starting at 08:00, and retries failed deliveries hourly through the reminder day. Starting/restarting after 08:00 on that day catches up. It does not send reminders for previous days. Successful sends are recorded by organization, recipient email hash, year and quarter; transaction locks prevent concurrent replicas from sending the same reminder simultaneously. A crash after provider acceptance but before the database commit can still cause a duplicate.

Run `node --test tests/quarterly-tax-reminder.test.js` in the API container. Tests use stub email delivery and send no real messages.

`node scripts/verify-quarterly-tax-reminders.js` checks recipient selection and delivery persistence against MySQL using connection-local temporary tables and a stub sender. It does not change application records or send email.
