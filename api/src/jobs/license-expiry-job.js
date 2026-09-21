const { Op } = require('sequelize');
const { getModels } = require('../sequelize');

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
};

