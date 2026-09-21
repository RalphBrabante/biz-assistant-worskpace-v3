const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args, directory) {
  execFileSync(npm, args, {
    cwd: path.join(root, directory), stdio: 'inherit',
    env: { ...process.env, NG_BUILD_MAX_WORKERS: process.env.NG_BUILD_MAX_WORKERS || '2' },
  });
}
function copy(source) {
  fs.cpSync(path.join(root, source), path.join(output, source), { recursive: true });
}

// No database connections or migrations during a build.
run(['ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], 'api');
run(['ci', '--include=dev', '--include=optional', '--no-audit', '--no-fund'], 'client');
fs.rmSync(path.join(root, 'api/dist'), { recursive: true, force: true });
run(['run', 'build', '--', '--incremental', 'false'], 'api');
run(['run', 'build', '--', '--configuration', 'production', '--progress=false'], 'client');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of [
  'server.js', 'scripts/runtime-config.cjs', 'scripts/migrate.cjs',
  'api/dist', 'api/package.json', 'api/package-lock.json',
  'client/dist/angular-client/browser',
]) copy(file);
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({
  name: 'biz-assistant-release', version: '1.0.0', private: true,
  main: 'server.js', engines: { node: '22.x' }, scripts: { start: 'node server.js' },
}, null, 2) + '\n');
run(['ci', '--omit=dev', '--include=optional', '--no-audit', '--no-fund'], 'dist/api');
console.log('Hostinger release ready: dist/ (entry: server.js).');
