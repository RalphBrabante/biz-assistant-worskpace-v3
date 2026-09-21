const { getModels } = require('../sequelize');

let redisClient = null;
let cacheEnabled = true;

function setRedisClient(client) {
  redisClient = client || null;
}

function getRedisClient() {
  return redisClient;
}

function getCacheEnabled() {
  return Boolean(cacheEnabled);
}

async function setCacheEnabled(enabled) {
  cacheEnabled = Boolean(enabled);
  if (!cacheEnabled) {
    await clearAllApiCache();
  }
}

async function initializeCacheConfig() {
  try {
    const models = getModels();
    if (!models || !models.AppSetting) {
      cacheEnabled = true;
      return;
    }

    const setting = await models.AppSetting.findOne({
      where: { key: 'cache_enabled' },
    });

    if (!setting) {
      cacheEnabled = true;
      return;
    }

    if (setting.valueBoolean === null || setting.valueBoolean === undefined) {
      cacheEnabled = true;
      return;
    }

    cacheEnabled = Boolean(setting.valueBoolean);
  } catch (err) {
    cacheEnabled = true;
  }
}

function buildSortedQueryString(query = {}) {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function getCacheScope(req) {
  const roleCodes = Array.isArray(req.auth?.roleCodes) ? req.auth.roleCodes : [];
  const isSuperuser = roleCodes.includes('superuser');

  if (isSuperuser) {
    const selectedOrganizationId =
      req.get('x-organization-id') || req.query?.organizationId || 'all';
    return `superuser:${selectedOrganizationId}`;
  }

  return String(req.auth?.user?.organizationId || req.auth?.userId || 'anonymous');
}

function buildCacheKey(req) {
  const path = `${req.baseUrl || ''}${req.path || ''}`;
  const queryString = buildSortedQueryString(req.query || {});

  if (/^\/api\/v1\/items\/?$/.test(path)) {
    const scope = getCacheScope(req);
    if (!queryString && scope === 'superuser:all') {
      return 'cache:items';
    }
    if (!queryString) {
      return `cache:items:${scope}`;
    }
    return `cache:items:${scope}:${queryString}`;
  }

  const userId = String(req.auth?.userId || 'anonymous');
  if (!queryString) {
    return `cache:${userId}:${path}`;
  }
  return `cache:${userId}:${path}:${queryString}`;
}

async function getCachedJson(key) {
  if (!redisClient || !cacheEnabled) {
    return null;
  }
  const payload = await redisClient.get(key);
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch (err) {
    return null;
  }
}

async function setCachedJson(key, value, ttlSeconds = 60) {
  if (!redisClient || !cacheEnabled) {
    return;
  }
  await redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

async function clearAllApiCache() {
  if (!redisClient) {
    return;
  }

  const patterns = ['cache:*', 'api_cache:*'];
  for (const pattern of patterns) {
    let cursor = '0';
    do {
      // eslint-disable-next-line no-await-in-loop
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = nextCursor;
      if (keys && keys.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await redisClient.del(...keys);
      }
    } while (cursor !== '0');
  }
}

module.exports = {
  setRedisClient,
  getRedisClient,
  getCacheEnabled,
  setCacheEnabled,
  initializeCacheConfig,
  buildCacheKey,
  getCachedJson,
  setCachedJson,
  clearAllApiCache,
};
