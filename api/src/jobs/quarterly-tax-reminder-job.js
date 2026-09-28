const {createHash} = require('crypto');
const {getModels} = require('../sequelize');
const {sendMail} = require('../services/email-service');
const OFFSET = 8 * 60 * 60 * 1000;
let timer, running, lastAttemptHour;

function reminderPeriod(now = new Date()) {
  const local = new Date(now.getTime() + OFFSET);
  const month = local.getUTCMonth();
  if (local.getUTCDate() !== 15 || month % 3 !== 0 || local.getUTCHours() < 8) return null;
  const year = local.getUTCFullYear() - (month === 0 ? 1 : 0);
  const quarter = month === 0 ? 4 : month / 3;
  const end = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
  return {year, quarter, end};
}

const RECIPIENTS_SQL = `
SELECT DISTINCT o.id AS organizationId, o.name AS organizationName,
       u.email, u.first_name AS firstName
FROM organizations o
JOIN users u ON u.is_active = 1 AND u.status = 'active'
LEFT JOIN organization_users ou ON ou.organization_id = o.id AND ou.user_id = u.id
WHERE o.is_active = 1
  AND (ou.is_active = 1 OR (ou.id IS NULL AND u.organization_id = o.id))
  AND (LOWER(u.role) = 'administrator' OR LOWER(ou.role) = 'administrator' OR EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = u.id AND ur.is_active = 1 AND r.is_active = 1
      AND LOWER(r.code) = 'administrator'
  ))
ORDER BY o.id, u.email`;

async function administratorRecipients(sequelize) {
  const [rows] = await sequelize.query(RECIPIENTS_SQL);
  const seen = new Set();
  return rows.filter(row => {
    row.email = String(row.email || '').trim().toLowerCase();
    const key = `${row.organizationId}:${row.email}`;
    if (!row.email || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
function reminderMessage(recipient, period) {
  const reportsUrl = new URL('/reports', process.env.APP_BASE_URL || 'http://localhost').href;
  const title = `Q${period.quarter} ${period.year} tax filing reminder`;
  const greeting = `Hi ${recipient.firstName || 'Administrator'},`;
  const body = `It has been 15 days since the end of Q${period.quarter} ${period.year} (${period.end}). Please review ${recipient.organizationName}'s quarterly reports and file the applicable taxes. If you have already filed, no further action is needed for this reminder.`;
  return {
    toEmail: recipient.email,
    subject: `${title} — ${recipient.organizationName}`,
    text: `${greeting}\n\n${body}\n\nOpen Reports: ${reportsUrl}\nSelect ${recipient.organizationName} and the relevant quarter.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1e293b"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(reportsUrl)}" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:white;border-radius:6px;text-decoration:none">Open Reports</a></p><p>Select ${escapeHtml(recipient.organizationName)} and the relevant quarter.</p></div>`,
  };
}

async function sendQuarterlyTaxReminders(now = new Date(), dependencies = {}) {
  const period = reminderPeriod(now);
  if (!period) return {sent: 0, failed: 0, skipped: true};
  const sequelize = dependencies.sequelize || getModels().Organization.sequelize;
  const send = dependencies.send || sendMail;
  const recipients = await administratorRecipients(sequelize);
  let sent = 0, failed = 0;
  for (const recipient of recipients) {
    try {
      await sequelize.transaction(async transaction => {
        const replacements = {org: recipient.organizationId, year: period.year, quarter: period.quarter, hash: createHash('sha256').update(recipient.email).digest('hex')};
        const options = {replacements, transaction};
        await sequelize.query('INSERT IGNORE INTO quarterly_tax_reminder_deliveries (organization_id, tax_year, quarter, recipient_hash) VALUES (:org, :year, :quarter, :hash)', options);
        const [rows] = await sequelize.query('SELECT sent_at FROM quarterly_tax_reminder_deliveries WHERE organization_id = :org AND tax_year = :year AND quarter = :quarter AND recipient_hash = :hash FOR UPDATE', options);
        if (rows[0].sent_at) return;
        await send(reminderMessage(recipient, period));
        await sequelize.query('UPDATE quarterly_tax_reminder_deliveries SET sent_at = CURRENT_TIMESTAMP WHERE organization_id = :org AND tax_year = :year AND quarter = :quarter AND recipient_hash = :hash', options);
        sent++;
      });
    } catch (error) {
      failed++;
      console.error(`[quarterly-tax-reminder-job] Organization ${recipient.organizationId}: ${error.message}`);
    }
  }
  return {sent, failed, skipped: false};
}

function startQuarterlyTaxReminderJob() {
  if (timer || process.env.QUARTERLY_TAX_REMINDER_JOB_ENABLED === 'false') return;
  lastAttemptHour = undefined;
  const tick = () => {
    const now = new Date();
    const hour = new Date(now.getTime() + OFFSET).toISOString().slice(0, 13);
    if (running || !reminderPeriod(now) || hour === lastAttemptHour) return;
    lastAttemptHour = hour;
    running = sendQuarterlyTaxReminders(now)
      .then(result => console.log('[quarterly-tax-reminder-job]', result))
      .catch(error => console.error('[quarterly-tax-reminder-job]', error.message))
      .finally(() => {running = undefined;});
  };
  // Poll the clock without database traffic except on eligible hours. This also
  // catches a restart on the reminder date and retries failed deliveries hourly.
  timer = setInterval(tick, 60000);
  timer.unref();
  tick();
  console.log('[quarterly-tax-reminder-job] Scheduled Jan/Apr/Jul/Oct 15 at 08:00 Asia/Singapore.');
}
async function stopQuarterlyTaxReminderJob() {clearInterval(timer); timer = undefined; if (running) await running;}
module.exports = {reminderPeriod, administratorRecipients, reminderMessage, sendQuarterlyTaxReminders, startQuarterlyTaxReminderJob, stopQuarterlyTaxReminderJob};
