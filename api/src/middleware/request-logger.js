const crypto = require('crypto');

// req.ip honours the app's trust-proxy setting; a raw X-Forwarded-For header is client-controlled
function resolveIp(req) {
  return req.ip || req.socket?.remoteAddress || '-';
}

// OAuth callbacks and token links carry one-time secrets in the query string
const SENSITIVE_QUERY_PATHS = /\/(callback|reset-password|verify-email)(\/|\?|$)/i;

function loggablePath(req) {
  const url = String(req.originalUrl || '');
  return SENSITIVE_QUERY_PATHS.test(url) ? url.split('?')[0] : url;
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
      `[REQUEST] id=${requestId} ip=${ip} user=${userId} method=${req.method} path=${loggablePath(req)} status=${res.statusCode} durationMs=${elapsedMs.toFixed(
        2
      )} bytes=${contentLength}`
    );
  });

  next();
}

module.exports = {
  requestLogger,
};
