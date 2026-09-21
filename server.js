'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { validateEnvironment } = require('./scripts/runtime-config.cjs');

async function start() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  validateEnvironment(process.env, fs.realpathSync(__dirname));
  process.env.CLIENT_DIST_DIR = path.join(__dirname, 'client/dist/angular-client/browser');
  if (!fs.existsSync(path.join(process.env.CLIENT_DIST_DIR, 'index.html'))) {
    throw new Error('Frontend build is missing. Run npm run build before starting.');
  }
  fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
  process.chdir(path.join(__dirname, 'api'));
  if (process.env.RUN_MIGRATIONS === 'true') {
    await require('./scripts/migrate.cjs').migrate();
  }
  require('./api/dist/main.js');
}

start().catch((error) => {
  console.error('Application startup failed:', error.message);
  process.exit(1);
});
