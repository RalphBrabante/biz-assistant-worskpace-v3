const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { sourceIdentity, resolveSpacesKey, copySpacesObject, hash } = require('../src/services/spaces-local-copy');
const source = sourceIdentity({ endpoint: 'receipts.sgp1.digitaloceanspaces.com', region: 'sgp1', bucket: 'receipts', cdnBaseUrl: 'https://files.example.test/receipts' });

test('resolves bucket, path-style, Spaces CDN and custom CDN URLs without signed query strings', () => {
  for (const url of ['https://receipts.sgp1.digitaloceanspaces.com/a%20b/c.pdf?signature=ignored',
    'https://sgp1.digitaloceanspaces.com/receipts/a%20b/c.pdf',
    'https://receipts.sgp1.cdn.digitaloceanspaces.com/a%20b/c.pdf',
    'https://files.example.test/receipts/a%20b/c.pdf']) {
    assert.equal(resolveSpacesKey(url, source), 'a b/c.pdf');
  }
  assert.equal(source.endpoint, 'https://sgp1.digitaloceanspaces.com');
});

test('rejects unrelated hosts, buckets, CDN prefixes, malformed escapes and local files', () => {
  for (const url of ['/uploads/a.pdf', 'https://evil.test/a', 'https://receipts.sgp1.digitaloceanspaces.com.evil.test/a',
    'https://sgp1.digitaloceanspaces.com/other/a', 'https://files.example.test/receipts-other/a',
    'https://user@receipts.sgp1.digitaloceanspaces.com/a', 'https://receipts.sgp1.digitaloceanspaces.com/%ZZ']) {
    assert.equal(resolveSpacesKey(url, source), null, url);
  }
  assert.throws(() => sourceIdentity({ endpoint: 'http://localhost', bucket: 'receipts' }));
  assert.throws(() => sourceIdentity({ endpoint: 'https://different.sgp1.digitaloceanspaces.com', bucket: 'receipts' }));
});

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spaces-copy-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const data = Buffer.from('%PDF-1.7 test receipt');
  const client = { send: async (command) => {
    assert.equal(command.input.Bucket, source.bucket);
    return { Body: Readable.from([data]), ContentLength: data.length, ContentType: 'application/pdf', ETag: 'etag', ...overrides };
  } };
  return { directory, client, data, source, key: '../../outside/receipt.pdf', signal: AbortSignal.timeout(3000) };
}

test('copies, reads back, hashes, deduplicates and confines even hostile object keys to uploads', async (t) => {
  const input = await fixture(t);
  const result = await copySpacesObject(input);
  assert.match(result.url, /^\/uploads\/migrated\/[a-f0-9]{20}\/[a-f0-9]{64}\.pdf$/);
  assert.equal(result.sha256, hash(input.data)); assert.equal(result.bytes, input.data.length);
  assert.deepEqual(await fs.readFile(path.join(input.directory, result.url.slice('/uploads/'.length))), input.data);
  const second = await copySpacesObject(input); assert.equal(second.url, result.url);
  assert.equal((await fs.readdir(path.join(input.directory, 'migrated', hash(`${source.endpoint}/${source.bucket}`).slice(0, 20)))).length, 1);
});

test('length mismatch or byte limit never publishes a partial file', async (t) => {
  for (const override of [{ ContentLength: 999 }, { ContentLength: undefined }]) {
    const input = await fixture(t, override);
    await assert.rejects(copySpacesObject({ ...input, ...(override.ContentLength === undefined ? { maxBytes: 2 } : {}) }));
    const folder = path.join(input.directory, 'migrated', hash(`${source.endpoint}/${source.bucket}`).slice(0, 20));
    assert.deepEqual(await fs.readdir(folder), []);
  }
});

test('an existing corrupted destination is never accepted or overwritten', async (t) => {
  const input = await fixture(t);
  const result = await copySpacesObject(input);
  const target = path.join(input.directory, result.url.slice('/uploads/'.length));
  await fs.writeFile(target, 'corrupted');
  await assert.rejects(copySpacesObject(input), /failed checksum/);
  assert.equal(await fs.readFile(target, 'utf8'), 'corrupted');
});

test('missing objects, denied access and aborted streams reject without a successful copy', async (t) => {
  const input = await fixture(t);
  for (const name of ['NoSuchKey', 'AccessDenied']) {
    await assert.rejects(copySpacesObject({ ...input, client: { send: async () => { throw Object.assign(new Error(name), { name }); } } }), { name });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(copySpacesObject({ ...input, signal: controller.signal }), { name: 'AbortError' });
});

test('active document formats are stored as downloads, not HTML served from the app origin', async (t) => {
  const input = await fixture(t, { ContentType: 'text/html' });
  assert.match((await copySpacesObject(input)).url, /\.bin$/);
});
