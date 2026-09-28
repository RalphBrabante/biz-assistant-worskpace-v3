const {Op, col, where} = require('sequelize');
const {getModels} = require('../sequelize');
const {sendMail} = require('../services/email-service');
const {debtView} = require('../services/debt-amounts');
const OFFSET = 8 * 60 * 60 * 1000; // Singapore and Philippines: UTC+8, no daylight saving.
let timer;
let running;
let stopped = true;
function localDate(now) {return new Date(now.getTime() + OFFSET).toISOString().slice(0, 10);}
function delayUntilMorning(now = new Date()) {
  let next = Date.parse(`${localDate(now)}T08:00:00+08:00`);
  if (next <= now.getTime()) next += 24 * 60 * 60 * 1000;
  return next - now.getTime();
}
function escapeHtml(value) {return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));}
function reminderMessage(org, debts, day) {
  const url = new URL('/debts', process.env.APP_BASE_URL || 'http://localhost').href;
  const lines = debts.map(model => {
    const debt = debtView(model);
    return `${debt.title} — ${debt.creditor}: ${debt.currency} ${debt.remainingAmount} remaining (due ${debt.dueOn})`;
  });
  return {
    toEmail: org.contactEmail,
    subject: `Overdue debt reminder — ${day} (${debts.length})`,
    text: [`${org.name}: overdue debts`, '', ...lines, '', `Review debts and record payments: ${url}`].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#1e293b"><h2>Overdue debt reminder</h2><p>${escapeHtml(org.name)} · ${escapeHtml(day)}</p><p>The following debts have an unpaid balance past their due date:</p><ul>${lines.map(line => `<li style="margin:12px 0">${escapeHtml(line)}</li>`).join('')}</ul><p><a href="${escapeHtml(url)}">Review debts and record payments</a></p></div>`,
  };
}
async function sendOverdueReminders(now = new Date(), dependencies = {}) {
  const models = dependencies.models || getModels();
  const send = dependencies.send || sendMail;
  const day = localDate(now);
  let sent = 0, failed = 0;
  const organizations = await models.Organization.findAll({where: {isActive: true}, attributes: ['id', 'name', 'contactEmail']});
  for (const org of organizations) {
    if (!org.contactEmail) continue;
    try {
      // The unique daily row and transaction lock serialize deliveries across API replicas.
      await models.Debt.sequelize.transaction(async transaction => {
        const sequelize = models.Debt.sequelize;
        const options = {replacements: {org: org.id, day}, transaction};
        await sequelize.query('INSERT IGNORE INTO debt_reminder_deliveries (organization_id, reminder_date) VALUES (:org, :day)', options);
        const [rows] = await sequelize.query('SELECT sent_at FROM debt_reminder_deliveries WHERE organization_id = :org AND reminder_date = :day FOR UPDATE', options);
        if (rows[0].sent_at) return;
        const debts = await models.Debt.findAll({where: {organizationId: org.id, dueOn: {[Op.lt]: day}, [Op.and]: where(col('paid_amount'), Op.lt, col('original_amount'))}, order: [['dueOn', 'ASC'], ['id', 'ASC']], transaction});
        if (!debts.length) return;
        await send(reminderMessage(org, debts, day));
        await sequelize.query('UPDATE debt_reminder_deliveries SET sent_at = CURRENT_TIMESTAMP WHERE organization_id = :org AND reminder_date = :day', options);
        sent++;
      });
    } catch (error) {failed++; console.error(`[debt-reminder-job] Organization ${org.id}: ${error.message}`);}
  }
  return {sent, failed};
}
function startDebtReminderJob() {
  if (!stopped || process.env.DEBT_REMINDER_JOB_ENABLED === 'false') return;
  stopped = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = sendOverdueReminders().then(result => console.log('[debt-reminder-job]', result)).catch(error => console.error('[debt-reminder-job]', error.message)).finally(() => {running = undefined; schedule();});
    }, delayUntilMorning());
    timer.unref();
  };
  schedule();
  console.log('[debt-reminder-job] Scheduled daily at 08:00 Asia/Singapore.');
}
async function stopDebtReminderJob() {stopped = true; clearTimeout(timer); if (running) await running;}
module.exports = {localDate, delayUntilMorning, reminderMessage, sendOverdueReminders, startDebtReminderJob, stopDebtReminderJob};
