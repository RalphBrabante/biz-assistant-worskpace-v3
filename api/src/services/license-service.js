const { Op, QueryTypes } = require('sequelize');
const { fail } = require('./debt-amounts');

const LICENSE_STATUSES = ['active', 'expired', 'revoked', 'suspended'];
// Expiry notices go out once per stage, in this order. Stage 0 is the "expired" notice.
const EXPIRY_NOTICE_DAYS = [30, 7, 1];
const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXTENSION_MONTHS = 120;

// The one definition of a license that grants access. Login, every API request and
// socket connections all use it, so they cannot disagree about who is licensed.
function activeLicenseWhere(now = new Date()) {
  return {
    isActive: true,
    status: 'active',
    revokedAt: null,
    expiresAt: { [Op.gte]: now },
  };
}

async function findActiveLicense(models, organizationId, { now = new Date(), transaction, lock } = {}) {
  if (!models?.License || !organizationId) {
    return null;
  }
  return models.License.findOne({
    where: { organizationId, ...activeLicenseWhere(now) },
    order: [['expiresAt', 'DESC']],
    transaction,
    lock,
  });
}

function toDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(expiresAt, now = new Date()) {
  const date = toDate(expiresAt);
  if (!date) {
    return null;
  }
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

// The notice a license is due right now: 30, 7 or 1 day(s) ahead, 0 once expired, or null.
function expiryNoticeStage(expiresAt, now = new Date()) {
  const date = toDate(expiresAt);
  if (!date) {
    return null;
  }
  if (date.getTime() < now.getTime()) {
    return 0;
  }
  const days = daysUntil(date, now);
  const due = EXPIRY_NOTICE_DAYS.filter((threshold) => days <= threshold);
  return due.length ? Math.min(...due) : null;
}

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  // Clamp to the month's last day so Jan 31 + 1 month is Feb 28/29, not Mar 3.
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

// An extension adds time from the current expiry, or from now when the license has already lapsed,
// so renewing early never loses days and renewing late never back-dates access.
function extendedExpiry(license, request = {}, now = new Date()) {
  const explicit = request.expiresAt !== undefined && request.expiresAt !== null && request.expiresAt !== '';
  if (explicit) {
    const target = toDate(request.expiresAt);
    if (!target) {
      throw fail(400, 'Enter a valid new expiry date.');
    }
    if (target.getTime() <= now.getTime()) {
      throw fail(400, 'The new expiry date must be in the future.');
    }
    const current = toDate(license.expiresAt);
    if (current && target.getTime() <= current.getTime()) {
      throw fail(400, 'The new expiry date must be after the current expiry date.');
    }
    return target;
  }

  const months = Number(request.months || 0) + Number(request.years || 0) * 12;
  if (!Number.isInteger(months) || months < 1 || months > MAX_EXTENSION_MONTHS) {
    throw fail(400, `Choose an extension from 1 to ${MAX_EXTENSION_MONTHS} months, or a new expiry date.`);
  }
  const current = toDate(license.expiresAt);
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addMonths(base, months);
}

// Checks a create or update against the license it would produce.
// Returns a message for the first problem found, or null.
function licenseValidationError(next) {
  if (next.status !== undefined && !LICENSE_STATUSES.includes(next.status)) {
    return `Status must be one of: ${LICENSE_STATUSES.join(', ')}.`;
  }
  const planName = String(next.planName ?? '').trim();
  if (!planName) {
    return 'Plan is required.';
  }
  if (planName.length > 100) {
    return 'Plan must be 100 characters or fewer.';
  }
  const startsAt = toDate(next.startsAt);
  const expiresAt = toDate(next.expiresAt);
  if (!startsAt) {
    return 'Enter a valid start date.';
  }
  if (!expiresAt) {
    return 'Enter a valid expiry date.';
  }
  if (expiresAt.getTime() <= startsAt.getTime()) {
    return 'The expiry date must be after the start date.';
  }
  if (next.maxUsers !== undefined && next.maxUsers !== null) {
    const maxUsers = Number(next.maxUsers);
    if (!Number.isInteger(maxUsers) || maxUsers < 0 || maxUsers > 100000) {
      return 'Max users must be a whole number from 0 to 100,000. Leave it blank for unlimited.';
    }
  }
  return null;
}

// 0 and blank both mean "no limit". Licenses created before seat limits were enforced default to 0.
function seatLimit(license) {
  const maxUsers = Number(license?.maxUsers || 0);
  return Number.isInteger(maxUsers) && maxUsers > 0 ? maxUsers : null;
}

// A seat is an active account that is an active member of the organization, or that belongs to it
// through users.organization_id without a membership row. Platform superusers never use a seat.
const SEAT_USAGE_SQL = `
SELECT seats.organization_id AS organizationId, COUNT(DISTINCT seats.user_id) AS used
FROM (
  SELECT ou.organization_id, ou.user_id
  FROM organization_users ou
  WHERE ou.organization_id IN (:organizationIds) AND ou.is_active = 1
  UNION
  SELECT u.organization_id, u.id AS user_id
  FROM users u
  WHERE u.organization_id IN (:organizationIds)
    AND NOT EXISTS (
      SELECT 1 FROM organization_users x WHERE x.user_id = u.id AND x.organization_id = u.organization_id
    )
) seats
JOIN users member ON member.id = seats.user_id AND member.is_active = 1
WHERE (:excludeUserId IS NULL OR seats.user_id <> :excludeUserId)
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = seats.user_id AND r.code = 'superuser'
  )
GROUP BY seats.organization_id`;

async function seatUsage(models, organizationIds, { excludeUserId = null, transaction } = {}) {
  const ids = [...new Set((organizationIds || []).filter(Boolean))];
  const usage = new Map(ids.map((id) => [id, 0]));
  const sequelize = models?.License?.sequelize;
  if (!ids.length || !sequelize) {
    return usage;
  }
  const rows = await sequelize.query(SEAT_USAGE_SQL, {
    type: QueryTypes.SELECT,
    replacements: { organizationIds: ids, excludeUserId },
    transaction,
  });
  for (const row of rows) {
    usage.set(row.organizationId, Number(row.used || 0));
  }
  return usage;
}

async function isPlatformSuperuser(models, userId, transaction) {
  if (!userId || !models?.License?.sequelize) {
    return false;
  }
  const rows = await models.License.sequelize.query(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = :userId AND r.code = 'superuser' LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { userId }, transaction }
  );
  return rows.length > 0;
}

// Call before a user becomes an active member of an organization. Counts everyone else,
// so retrying for someone who already holds a seat never fails. Within a transaction the
// license row is locked, which serializes simultaneous additions to the same organization.
async function assertSeatAvailable(models, organizationId, { userId = null, transaction, now = new Date() } = {}) {
  if (!models?.License || !organizationId) {
    return;
  }
  // Organizations without an active license are already blocked at sign-in.
  const license = await findActiveLicense(models, organizationId, {
    now,
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  const limit = seatLimit(license);
  if (!limit || await isPlatformSuperuser(models, userId, transaction)) {
    return;
  }
  const usage = await seatUsage(models, [organizationId], { excludeUserId: userId, transaction });
  const used = usage.get(organizationId) || 0;
  if (used >= limit) {
    throw fail(
      409,
      `This organization's license allows ${limit} active user${limit === 1 ? '' : 's'} and all seats are in use. ` +
        'Deactivate a member or ask your provider to add seats.'
    );
  }
}

// Other active licenses for the same organization whose dates overlap this one.
// Overlap is allowed (renewals are often added ahead of time) but the person creating it should know.
async function overlappingLicenses(models, license, { now = new Date() } = {}) {
  if (!models?.License || !license?.organizationId) {
    return [];
  }
  const startsAt = toDate(license.startsAt) || now;
  const expiresAt = toDate(license.expiresAt);
  if (!expiresAt) {
    return [];
  }
  const where = {
    organizationId: license.organizationId,
    status: 'active',
    isActive: true,
    revokedAt: null,
    startsAt: { [Op.lt]: expiresAt },
    expiresAt: { [Op.gt]: startsAt },
  };
  if (license.id) {
    where.id = { [Op.ne]: license.id };
  }
  return models.License.findAll({
    where,
    attributes: ['id', 'key', 'planName', 'startsAt', 'expiresAt'],
    order: [['expiresAt', 'DESC']],
  });
}

function overlapWarnings(overlaps) {
  return overlaps.map((other) => {
    const expires = toDate(other.expiresAt)?.toISOString().slice(0, 10) || 'unknown';
    return `This organization already has an active ${other.planName || ''} license (${String(other.key).slice(0, 8)}…) running until ${expires}. Both will apply until one ends.`;
  });
}

module.exports = {
  LICENSE_STATUSES,
  EXPIRY_NOTICE_DAYS,
  EXPIRING_SOON_DAYS,
  activeLicenseWhere,
  findActiveLicense,
  toDate,
  daysUntil,
  expiryNoticeStage,
  addMonths,
  extendedExpiry,
  licenseValidationError,
  seatLimit,
  seatUsage,
  assertSeatAvailable,
  overlappingLicenses,
  overlapWarnings,
};
