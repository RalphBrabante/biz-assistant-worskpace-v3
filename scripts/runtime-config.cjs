const path = require('node:path');

function validateEnvironment(env, appDirectory) {
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'UPLOAD_DIR', 'APP_BASE_URL']) {
    if (!env[key]?.trim()) throw new Error(`Required environment variable missing: ${key}`);
  }
  if (env.NODE_ENV !== 'production') throw new Error('The deployment entry point requires NODE_ENV=production.');
  if (!path.isAbsolute(env.UPLOAD_DIR)) throw new Error('UPLOAD_DIR must be an absolute, persistent directory.');
  const relative = path.relative(appDirectory, path.resolve(env.UPLOAD_DIR));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('UPLOAD_DIR must be outside the deployment directory.');
  }
  if (/[\\/]hbuilds[\\/]/.test(env.UPLOAD_DIR)) throw new Error('UPLOAD_DIR must be outside Hostinger hbuilds.');
  for (const key of ['RUN_MIGRATIONS', 'REDIS_ENABLED', 'AMQP_ENABLED', 'LICENSE_EXPIRY_JOB_ENABLED']) {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key])) {
      throw new Error(`${key} must be true or false.`);
    }
  }
  const url = new URL(env.APP_BASE_URL);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('APP_BASE_URL must use HTTPS in production.');
  }
}
module.exports = { validateEnvironment };
