const {
  getRedisClient,
  getCacheEnabled,
} = require('../services/cache-service');

async function inspectDevCache(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'This endpoint is available only in development.',
      });
    }

    const redisClient = getRedisClient();
    if (!redisClient) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Redis cache is not connected.',
      });
    }

    const keys = [];
    const patterns = ['cache:*', 'api_cache:*'];

    for (const pattern of patterns) {
      let cursor = '0';
      do {
        // eslint-disable-next-line no-await-in-loop
        const [nextCursor, matchedKeys] = await redisClient.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500
        );
        cursor = nextCursor;
        if (matchedKeys && matchedKeys.length > 0) {
          keys.push(...matchedKeys);
        }
      } while (cursor !== '0');
    }

    const uniqueKeys = Array.from(new Set(keys)).sort((a, b) => a.localeCompare(b));
    const values = [];
    for (const key of uniqueKeys) {
      // eslint-disable-next-line no-await-in-loop
      const type = await redisClient.type(key);
      if (type !== 'string') {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const rawValue = await redisClient.get(key);
      let parsedValue = rawValue;
      try {
        parsedValue = JSON.parse(rawValue);
      } catch (err) {
        // keep raw value
      }

      values.push({
        key,
        value: parsedValue,
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Cache data retrieved successfully.',
      data: {
        enabled: getCacheEnabled(),
        totalKeys: values.length,
        entries: values,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to inspect cache.',
    });
  }
}

module.exports = {
  inspectDevCache,
};
