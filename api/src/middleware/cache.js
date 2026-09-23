const {
  buildCacheKey,
  getCachedJson,
  setCachedJson,
  clearAllApiCache,
  getCacheEnabled,
  getCacheVersion,
} = require('../services/cache-service');

function shouldBypassReadCache(req) {
  if (req.method !== 'GET') {
    return true;
  }
  if (!getCacheEnabled()) {
    return true;
  }
  if (!req.auth?.userId) return true;
  if (/\b(no-cache|no-store)\b/i.test(req.get?.('cache-control') || '')) return true;
  if ((req.path || '').startsWith('/health')) {
    return true;
  }
  if (/^\/(?:api\/v1\/)?bug-reports(?:\/|$)/.test(req.path || '')) {
    return true;
  }
  if (/^\/(?:api\/v1\/)?orders(?:\/|$)/.test(req.path || '')) return true;
  // Re-evaluate permissions and live queues on every Action Center refresh.
  if (/^\/(?:api\/v1\/)?dashboard\/action-center\/?$/.test(req.path || '')) {
    return true;
  }
  if (/^\/(?:api\/v1\/)?settings\/storage\/migrations(?:\/|$)/.test(req.path || '')) {
    return true;
  }
  return false;
}

async function readCacheMiddleware(req, res, next) {
  try {
    if (shouldBypassReadCache(req)) {
      res.set('X-Cache', 'BYPASS');
      return next();
    }

    const cacheKey = buildCacheKey(req);
    const version = await getCacheVersion();
    const cached = await getCachedJson(cacheKey, version);
    if (cached && typeof cached.status === 'number') {
      res.set('X-Cache', 'HIT');
      return res.status(cached.status).json(cached.body);
    }

    res.set('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200 && !res.getHeader?.('set-cookie')) {
        setCachedJson(cacheKey, { status: res.statusCode, body }, undefined, version).catch(() => {});
      }
      return originalJson(body);
    };

    return next();
  } catch (err) {
    return next();
  }
}

function isWriteMethod(method = '') {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase());
}

function invalidateCacheOnWriteMiddleware(req, res, next) {
  // Authenticated API data is cached only on the server, scoped to identity.
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Cache', 'BYPASS');
  if (!isWriteMethod(req.method)) {
    return next();
  }

  const originalEnd = res.end.bind(res);
  let ending = false;
  res.end = (...args) => {
    if (ending) return res;
    ending = true;
    // Invalidate before acknowledging the write, including non-JSON responses
    // and failed imports that may have committed some rows already.
    clearAllApiCache().catch(() => {}).then(() => originalEnd(...args));
    return res;
  };
  return next();
}

module.exports = {
  readCacheMiddleware,
  invalidateCacheOnWriteMiddleware,
};
