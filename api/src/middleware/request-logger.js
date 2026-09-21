const crypto = require('crypto');

function resolveIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '-';
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestId =
    String(req.headers['x-request-id'] || '').trim() || crypto.randomUUID();
  const ip = resolveIp(req);

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const contentLength = res.getHeader('content-length') || 0;
    const userId = req.auth?.userId || '-';

    console.log(
      `[REQUEST] id=${requestId} ip=${ip} user=${userId} method=${req.method} path=${req.originalUrl} status=${res.statusCode} durationMs=${elapsedMs.toFixed(
        2
      )} bytes=${contentLength}`
    );
  });

  next();
}

module.exports = {
  requestLogger,
};
