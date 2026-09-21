const {
  buildCacheKey,
  getCachedJson,
  setCachedJson,
  clearAllApiCache,
  getCacheEnabled,
} = require('../services/cache-service');

function shouldBypassReadCache(req) {
  if (req.method !== 'GET') {
    return true;
  }
  if (!getCacheEnabled()) {
    return true;
  }
  if ((req.path || '').startsWith('/health')) {
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
    const cached = await getCachedJson(cacheKey);
    if (cached && typeof cached.status === 'number') {
      res.set('X-Cache', 'HIT');
      return res.status(cached.status).json(cached.body);
    }

    res.set('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const response = originalJson(body);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setCachedJson(cacheKey, { status: res.statusCode, body }).catch(() => {});
      }
      return response;
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
  if (!isWriteMethod(req.method)) {
    return next();
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const response = originalJson(body);
    if (res.statusCode >= 200 && res.statusCode < 400) {
      clearAllApiCache().catch(() => {});
    }
    return response;
  };
  return next();
}

module.exports = {
  readCacheMiddleware,
  invalidateCacheOnWriteMiddleware,
};
