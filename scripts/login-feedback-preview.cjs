// Local synthetic browser fixture: no database, external API, or real credentials.
// Run after npm --prefix client run build, then open http://127.0.0.1:4313/login.
// Password "success" succeeds, anything else returns a credential error after 3s.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../client/dist/angular-client/browser');
const user = { id: 'synthetic-user', email: 'synthetic@example.test', firstName: 'Synthetic', roleCodes: [], permissionCodes: [] };
let loginRequests = 0;
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__fixture/stats') return json(res, 200, { loginRequests });
  if (url.pathname === '/api/v1/auth/login') {
    loginRequests++;
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload; try { payload = JSON.parse(body); } catch { return json(res, 400, {}); }
      setTimeout(() => payload.password === 'success'
        ? json(res, 200, { data: { accessToken: 'synthetic-local-only', user } })
        : json(res, 401, { message: 'Invalid email or password. Please try again.' }), 3000);
    }); return;
  }
  if (url.pathname === '/api/v1/auth/session') return setTimeout(() => json(res, 200, { data: { user, expiresAt: new Date(Date.now() + 3600000).toISOString() } }), 3000);
  if (url.pathname.startsWith('/api/')) return json(res, 200, { data: [], total: 0 });
  // Never register a service worker in this fixture.
  if (url.pathname.includes('ngsw')) { res.writeHead(404); res.end(); return; }
  const candidate = path.resolve(root, '.' + url.pathname);
  if (!candidate.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
  const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(4313, '127.0.0.1', () => console.log('Synthetic login preview: http://127.0.0.1:4313/login'));
