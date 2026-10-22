const crypto = require('crypto');

// Ties an OAuth flow to the browser that started it: the state is also stored in an HttpOnly cookie
// scoped to the callback, so a connect link forwarded to someone else fails at the callback.
// The cookie can only reach the callback when it lives on the app's own host; if the configured
// redirect URI points elsewhere, binding is skipped rather than breaking every connection.
function bindingScope(redirectUri) {
  try {
    const callback = new URL(String(redirectUri || ''));
    const app = new URL(String(process.env.APP_BASE_URL || 'http://localhost'));
    return { enabled: callback.host === app.host, path: callback.pathname || '/' };
  } catch (_err) {
    return { enabled: false, path: '/' };
  }
}

function readCookie(req, name) {
  const pair = String(req.headers?.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return '';
  try {
    return decodeURIComponent(pair.slice(name.length + 1));
  } catch (_err) {
    return '';
  }
}

function bindToBrowser(req, res, name, value, redirectUri) {
  const scope = bindingScope(redirectUri);
  if (!scope.enabled) return;
  res.cookie(name, value, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: scope.path, maxAge: 10 * 60 * 1000 });
}

/** True when the callback came from the browser that started the flow (or binding is unavailable). */
function isSameBrowser(req, res, name, expected, redirectUri) {
  const scope = bindingScope(redirectUri);
  if (!scope.enabled) return true;
  const actual = readCookie(req, name);
  res.clearCookie(name, { path: scope.path });
  const a = Buffer.from(actual), b = Buffer.from(String(expected || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { bindToBrowser, isSameBrowser };
