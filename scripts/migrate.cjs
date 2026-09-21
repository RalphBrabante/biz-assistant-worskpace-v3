const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

async function migrate() {
  const api = path.resolve(__dirname, '../api');
  const mysql = require(path.join(api, 'node_modules/mysql2/promise'));
  const config = require(path.join(api, 'dist/config/config.js')).production;
  const connection = await mysql.createConnection({
    host: config.host, port: config.port, user: config.username,
    password: config.password, database: config.database, ...config.dialectOptions,
  });
  const lock = `biz-migrate-${crypto.createHash('sha256').update(config.database).digest('hex').slice(0, 40)}`;
  let locked = false;
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, 60) AS acquired', [lock]);
    if (Number(rows[0].acquired) !== 1) throw new Error('Could not acquire database migration lock.');
    locked = true;
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        path.join(api, 'node_modules/sequelize-cli/lib/sequelize'), 'db:migrate',
        '--env', 'production', '--config', path.join(api, 'dist/config/config.js'),
        '--migrations-path', path.join(api, 'dist/migrations'),
      ], { cwd: api, env: process.env, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Migration failed (${signal || code}).`)));
    });
  } finally {
    try {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
    } finally {
      await connection.end();
    }
  }
}
module.exports = { migrate };
