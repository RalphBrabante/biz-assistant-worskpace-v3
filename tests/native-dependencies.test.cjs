const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packages } = require('../client/package-lock.json');

// A platform-incomplete lockfile can work on a developer's machine but force
// node-gyp compilation on Hostinger, where a compatible compiler may be absent.
for (const name of ['lmdb', 'msgpackr-extract']) {
  test(`${name} locks every declared prebuilt platform package`, () => {
    const parent = packages[`node_modules/${name}`];
    assert.ok(parent?.optionalDependencies);
    for (const [dependency, version] of Object.entries(parent.optionalDependencies)) {
      const entry = packages[`node_modules/${dependency}`];
      assert.ok(entry, `Missing prebuilt package: ${dependency}`);
      assert.equal(entry.version, version, dependency);
      assert.equal(entry.optional, true, dependency);
      assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), dependency);
      assert.ok(entry.integrity?.startsWith('sha512-'), dependency);
    }
  });
}
