const { Op, QueryTypes } = require('sequelize');
const { getModels } = require('../sequelize');
const { sendLicenseExpiryEmail } = require('../services/email-service');
const { createOrganizationMessage } = require('../services/message-service');
const {
  EXPIRY_NOTICE_DAYS,
  activeLicenseWhere,
  daysUntil,
  expiryNoticeStage,
} = require('../services/license-service');

const DAY_MS = 24 * 60 * 60 * 1000;
// A license that lapsed before notices existed (or while the job was down) is not announced weeks later.
const EXPIRED_NOTICE_GRACE_MS = 7 * DAY_MS;

let intervalId = null;
let nextRunTimeoutId = null;

async function expireOverdueLicenses(now = new Date()) {
  const models = getModels();
  if (!models || !models.License) {
    return { updated: 0, skipped: true };
  }

  const [updated] = await models.License.update(
    { status: 'expired' },
    {
      where: {
        status: { [Op.ne]: 'expired' },
        revokedAt: null,
        expiresAt: { [Op.lt]: now },
      },
    }
  );

  return { updated: Number(updated || 0), skipped: false };
}

// The organization's own administrators. Falls back to its contact email when it has none.
const ADMINISTRATORS_SQL = `
SELECT DISTINCT u.email, u.first_name AS firstName, u.last_name AS lastName
FROM organization_roles r
JOIN organization_user_roles our ON our.organization_id = r.organization_id AND our.role_id = r.id
JOIN organization_users ou ON ou.organization_id = r.organization_id AND ou.user_id = our.user_id AND ou.is_active = 1
JOIN users u ON u.id = our.user_id AND u.is_active = 1 AND u.status = 'active'
WHERE r.organization_id = :organizationId AND r.preset_code = 'administrator' AND r.is_active = 1
ORDER BY u.email`;

async function noticeRecipients(sequelize, organization, transaction) {
  const rows = await sequelize.query(ADMINISTRATORS_SQL, {
    type: QueryTypes.SELECT,
    replacements: { organizationId: organization.id },
    transaction,
  });
  const recipients = [];
  const seen = new Set();
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, name: [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || email });
  }
  const contactEmail = String(organization.contactEmail || '').trim().toLowerCase();
  if (!recipients.length && contactEmail) {
    recipients.push({ email: contactEmail, name: organization.name || contactEmail });
  }
  return recipients;
}

function formatExpiry(date) {
  return new Date(date).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });
}

function noticeMessage(license, organization, now) {
  const days = Math.max(0, daysUntil(license.expiresAt, now));
  const expiresOn = formatExpiry(license.expiresAt);
  const name = organization.name || organization.legalName || 'This organization';
  if (license.expiresAt.getTime() < now.getTime()) {
    return {
      days: 0,
      expiresOn,
      title: 'License expired',
      message: `${name}'s ${license.planName} license expired on ${expiresOn}. Renew it to restore access.`,
    };
  }
  return {
    days,
    expiresOn,
    title: `License expires in ${days} day${days === 1 ? '' : 's'}`,
    message: `${name}'s ${license.planName} license expires on ${expiresOn}. Renew it to avoid losing access.`,
  };
}

function licensesUrl() {
  return new URL('/licenses', process.env.APP_BASE_URL || 'http://localhost').href;
}

// Sends each license's 30-, 7- and 1-day warnings and its expired notice once. The license row
// is locked while sending, so API replicas running this job at the same time cannot both send.
async function sendExpiryNotices(now = new Date(), dependencies = {}) {
  const models = dependencies.models || getModels();
  if (!models?.License) {
    return { sent: 0, failed: 0, skipped: true };
  }
  const send = dependencies.send || sendLicenseExpiryEmail;
  const notify = dependencies.notify || createOrganizationMessage;
  const { License, Organization } = models;
  const sequelize = License.sequelize;
  const furthestNotice = Math.max(...EXPIRY_NOTICE_DAYS) * DAY_MS;

  const candidates = await License.findAll({
    where: {
      organizationId: { [Op.ne]: null },
      isActive: true,
      revokedAt: null,
      status: { [Op.in]: ['active', 'expired'] },
      expiresAt: { [Op.between]: [new Date(now.getTime() - EXPIRED_NOTICE_GRACE_MS), new Date(now.getTime() + furthestNotice)] },
      [Op.or]: [{ expiryNoticeStage: null }, { expiryNoticeStage: { [Op.gt]: 0 } }],
    },
    attributes: ['id'],
  });

  let sent = 0;
  let failed = 0;
  for (const { id } of candidates) {
    try {
      const delivered = await sequelize.transaction(async (transaction) => {
        const license = await License.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        const stage = license && expiryNoticeStage(license.expiresAt, now);
        if (stage === null || stage === undefined) return null;
        if (license.expiryNoticeStage !== null && license.expiryNoticeStage <= stage) return null;

        const organization = await Organization.findByPk(license.organizationId, {
          attributes: ['id', 'name', 'legalName', 'contactEmail', 'isActive'],
          transaction,
        });
        // A renewal that is already in place (a later-expiring active license) keeps the organization
        // licensed, so warning about this one would only alarm people.
        const renewal = await License.findOne({
          where: {
            organizationId: license.organizationId,
            id: { [Op.ne]: license.id },
            ...activeLicenseWhere(now),
            expiresAt: { [Op.gt]: license.expiresAt },
          },
          attributes: ['id'],
          transaction,
        });

        let notice = null;
        if (organization && organization.isActive !== false && !renewal) {
          notice = noticeMessage(license, organization, now);
          const recipients = await noticeRecipients(sequelize, organization, transaction);
          const results = await Promise.allSettled(recipients.map((recipient) => send({
            toEmail: recipient.email,
            toName: recipient.name,
            organizationName: organization.name || organization.legalName,
            planName: license.planName,
            expiresOn: notice.expiresOn,
            daysRemaining: notice.days,
            licensesUrl: licensesUrl(),
          })));
          // Retry next hour only if nobody was reached. A partial failure is logged instead of resending to everyone.
          const failures = results.filter((result) => result.status === 'rejected');
          if (recipients.length && failures.length === recipients.length) {
            throw new Error(`All ${recipients.length} expiry notice email(s) failed: ${failures[0].reason?.message || failures[0].reason}`);
          }
          if (failures.length) {
            console.error(`[license-expiry-job] License ${license.id}: ${failures.length} of ${recipients.length} notice email(s) failed.`);
          }
        }

        await license.update({ expiryNoticeStage: stage, expiryNoticeSentAt: now }, { transaction });
        return notice && { license, notice };
      });

      if (delivered) {
        sent++;
        await notify({
          organizationId: delivered.license.organizationId,
          entityType: 'license',
          entityId: delivered.license.id,
          title: delivered.notice.title,
          message: delivered.notice.message,
          metadata: { daysRemaining: delivered.notice.days, expiresAt: delivered.license.expiresAt },
        });
      }
    } catch (err) {
      failed++;
      console.error(`[license-expiry-job] License ${id}: ${err.message}`);
    }
  }

  return { sent, failed, skipped: false };
}

async function runExpiryCycle() {
  try {
    const { updated, skipped } = await expireOverdueLicenses();
    if (skipped) {
      return;
    }
    if (updated > 0) {
      console.log(`[license-expiry-job] Marked ${updated} license(s) as expired.`);
    }
  } catch (err) {
    console.error('[license-expiry-job] Failed to mark expired licenses:', err.message);
  }

  try {
    const { sent, failed } = await sendExpiryNotices();
    if (sent > 0 || failed > 0) {
      console.log(`[license-expiry-job] Expiry notices: ${sent} sent, ${failed} failed.`);
    }
  } catch (err) {
    console.error('[license-expiry-job] Failed to send expiry notices:', err.message);
  }
}

function delayUntilNextHourMs(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function stopLicenseExpiryJob() {
  if (nextRunTimeoutId) {
    clearTimeout(nextRunTimeoutId);
    nextRunTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function startLicenseExpiryJob() {
  stopLicenseExpiryJob();

  const initialDelay = delayUntilNextHourMs();
  console.log(
    `[license-expiry-job] Scheduled to run hourly at the top of each hour. First run in ${Math.round(
      initialDelay / 1000
    )}s.`
  );

  nextRunTimeoutId = setTimeout(async () => {
    await runExpiryCycle();
    intervalId = setInterval(runExpiryCycle, 60 * 60 * 1000);
  }, initialDelay);
}

module.exports = {
  startLicenseExpiryJob,
  stopLicenseExpiryJob,
  expireOverdueLicenses,
  sendExpiryNotices,
  noticeMessage,
};
