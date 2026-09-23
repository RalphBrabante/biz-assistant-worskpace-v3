const { getModels } = require('../sequelize');
const { createHash, randomUUID } = require('node:crypto');
const { MemoryCache } = require('./memory-cache');

function boundedSetting(name, fallback, maximum) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

const ttlSeconds = boundedSetting('API_CACHE_TTL_SECONDS', 60, 600);
const maxEntries = boundedSetting('API_CACHE_MAX_ENTRIES', 500, 10000);
const maxBytes = boundedSetting('API_CACHE_MAX_BYTES', 32 * 1024 * 1024, 256 * 1024 * 1024);
const maxEntryBytes = boundedSetting('API_CACHE_MAX_ENTRY_BYTES', 1024 * 1024, 8 * 1024 * 1024);
const memory = new MemoryCache({ maxEntries, maxBytes, maxEntryBytes });
const GENERATION_KEY = 'api_cache:generation:v2';
let revision = 0;
let redisRetryAt = 0;
let activeBackend = null;

let redisClient = null;
let cacheEnabled = true;

function setRedisClient(client) {
  redisClient = client || null;
  revision += 1;
  memory.clear();
  redisRetryAt = 0;
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

// Sort object keys without collapsing array/object filter values into strings.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function buildCacheKey(req) {
  const identity = {
    path: (req.originalUrl || `${req.baseUrl || ''}${req.path || ''}`).split('?')[0],
    query: req.query || {},
    userId: req.auth?.userId,
    organizationId: req.auth?.user?.organizationId,
    selectedOrganizationId: req.get?.('x-organization-id') || null,
    roles: [...(req.auth?.roleCodes || [])].sort(),
    permissions: [...(req.auth?.permissions || [])].sort(),
    isPrivileged: Boolean(req.auth?.isPrivileged),
  };
  return createHash('sha256').update(JSON.stringify(canonical(identity))).digest('hex');
}

function useRedis() {
  return redisClient && (!redisClient.status || redisClient.status === 'ready') && Date.now() >= redisRetryAt;
}

function redisFailed() {
  // Wait out existing Redis entries before trying it again after a failed
  // invalidation. No old response can reappear when the connection recovers.
  redisRetryAt = Date.now() + ttlSeconds * 1000;
  revision += 1;
  memory.clear();
  activeBackend = 'memory';
}

async function getCacheVersion() {
  const backend = useRedis() ? 'redis' : 'memory';
  if (activeBackend !== backend) {
    revision += 1;
    memory.clear();
    activeBackend = backend;
  }
  const currentRevision = revision;
  if (useRedis()) {
    try {
      const generation = await redisClient.get(GENERATION_KEY) || '0';
      return { backend: 'redis', revision: currentRevision, generation };
    } catch {
      redisFailed();
    }
  }
  return { backend: 'memory', revision };
}

async function getCachedJson(key, version) {
  if (!cacheEnabled) return null;
  version = version || await getCacheVersion();
  if (version.revision !== revision) return null;
  let payload;
  if (version.backend === 'redis') {
    try {
      payload = await redisClient.get(`api_cache:v2:${version.generation}:${key}`);
    } catch {
      redisFailed();
      return null;
    }
  } else {
    payload = memory.get(key);
  }
  if (!cacheEnabled || version.revision !== revision || !payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

async function setCachedJson(key, value, requestedTtl = ttlSeconds, version) {
  if (!cacheEnabled) return;
  version = version || await getCacheVersion();
  if (version.revision !== revision) return;
  const ttl = Math.min(ttlSeconds, Math.floor(requestedTtl));
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  const payload = JSON.stringify(value);
  if (!payload || Buffer.byteLength(payload) + Buffer.byteLength(key) > maxEntryBytes) return;
  if (version.backend === 'redis') {
    try {
      // Generations keep a slow read from filling the current cache after a
      // concurrent write, including writes from another Redis-backed process.
      await redisClient.set(`api_cache:v2:${version.generation}:${key}`, payload, 'EX', ttl);
    } catch { redisFailed(); }
  } else {
    memory.set(key, payload, ttl);
  }
}

async function clearAllApiCache() {
  revision += 1;
  memory.clear();
  if (useRedis()) {
    try {
      // Old generations expire naturally; no blocking key scans on each write.
      await redisClient.set(GENERATION_KEY, randomUUID());
    } catch { redisFailed(); }
  } else if (redisClient) {
    redisFailed();
  }
}

function getCacheStatus() {
  memory.prune();
  return {
    backend: cacheEnabled ? (useRedis() ? 'redis' : 'memory') : 'disabled',
    ttlSeconds,
    maxEntries,
    maxBytes,
    maxEntryBytes,
    memoryEntries: memory.entries.size,
    memoryBytes: memory.bytes,
  };
}

module.exports = {
  setRedisClient,
  getRedisClient,
  getCacheEnabled,
  setCacheEnabled,
  initializeCacheConfig,
  buildCacheKey,
  getCacheVersion,
  getCacheStatus,
  getCachedJson,
  setCachedJson,
  clearAllApiCache,
};
