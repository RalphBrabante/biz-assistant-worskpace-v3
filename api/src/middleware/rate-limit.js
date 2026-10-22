const crypto = require('crypto');
const { getRedisClient } = require('../services/cache-service');

const memoryBuckets = new Map();
let lastMemorySweep = 0;

function sweepMemoryBuckets(now) {
  if (now - lastMemorySweep < 60 * 1000) return;
  lastMemorySweep = now;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
}

async function incrementBucket(key, windowMs) {
  const redis = getRedisClient();
  if (redis && redis.status === 'ready') {
    const [[, count], [, ttl]] = await redis.multi().incr(key).pttl(key).exec();
    if (Number(ttl) < 0) {
      await redis.pexpire(key, windowMs);
      return { count: Number(count), retryAfterMs: windowMs };
    }
    return { count: Number(count), retryAfterMs: Number(ttl) };
  }

  // Redis is optional; fall back to per-process counting
  const now = Date.now();
  sweepMemoryBuckets(now);
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { count: 1, retryAfterMs: windowMs };
  }
  bucket.count += 1;
  return { count: bucket.count, retryAfterMs: bucket.resetAt - now };
}

/**
 * Fixed-window limiter. `key(req)` returns the identity to count (or null to skip);
 * identities are hashed so emails never land in Redis in clear text.
 */
function rateLimit({ name, windowMs, max, key, message }) {
  return async (req, res, next) => {
    try {
      const identity = key(req);
      if (!identity) return next();
      const digest = crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 32);
      const { count, retryAfterMs } = await incrementBucket(`rate_limit:${name}:${digest}`, windowMs);
      if (count > max) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        return res.status(429).json({
          ok: false,
          code: 'RATE_LIMITED',
          message: message || 'Too many requests. Please wait a moment and try again.',
        });
      }
      return next();
    } catch (err) {
      // A limiter outage must not take authentication down with it
      console.error('Rate limiter error:', err);
      return next();
    }
  };
}

const clientIp = (req) => req.ip || req.socket?.remoteAddress || null;
const bodyEmail = (req) => String(req.body?.email || '').toLowerCase().trim() || null;

module.exports = { rateLimit, clientIp, bodyEmail };
