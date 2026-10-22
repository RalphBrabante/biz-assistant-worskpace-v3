// Only proxies on loopback/private networks (nginx on the Docker network, a host-local proxy) may
// supply the client IP via X-Forwarded-For. A client that reaches Node directly from a public address
// is never trusted, so it cannot pick its own IP to dodge per-IP rate limits and lockouts.
// TRUST_PROXY accepts anything Express's "trust proxy" setting does (hop count, IPs/CIDRs, presets).
function trustProxySetting(value = process.env.TRUST_PROXY) {
  const raw = String(value || '').trim();
  if (!raw) return 'loopback, linklocal, uniquelocal';
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return raw;
}

module.exports = { trustProxySetting };
