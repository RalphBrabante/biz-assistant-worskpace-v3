const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function sourceIdentity(config) {
  const endpoint = new URL(/^https?:\/\//i.test(config.endpoint) ? config.endpoint : `https://${config.endpoint}`);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port
      || !/^(?:[a-z0-9-]+\.)?[a-z0-9-]+\.digitaloceanspaces\.com$/.test(endpoint.hostname)) {
    throw new Error('Use an HTTPS DigitalOcean Spaces endpoint before scanning.');
  }
  const hostname = endpoint.hostname.startsWith(`${config.bucket}.`)
    ? endpoint.hostname.slice(config.bucket.length + 1) : endpoint.hostname;
  if (!/^[a-z0-9-]+\.digitaloceanspaces\.com$/.test(hostname)) {
    throw new Error('The Spaces endpoint and bucket do not match.');
  }
  let cdnBaseUrl = String(config.cdnBaseUrl || '').replace(/\/+$/, '');
  if (cdnBaseUrl) {
    const cdn = new URL(cdnBaseUrl);
    if (!['https:', 'http:'].includes(cdn.protocol) || cdn.username || cdn.password || cdn.port || cdn.search || cdn.hash) {
      throw new Error('Use a complete CDN base URL without credentials, query parameters, or fragments.');
    }
    cdnBaseUrl = cdn.href.replace(/\/+$/, '');
  }
  return { endpoint: `https://${hostname}`, region: config.region, bucket: config.bucket,
    cdnBaseUrl };
}

// Resolve only this bucket's URLs. Never fetch arbitrary URLs stored in a record.
function resolveSpacesKey(value, source) {
  if (!value || typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const endpoint = new URL(source.endpoint);
  const prefixes = [
    [`${source.bucket}.${endpoint.hostname}`, '/'],
    [`${source.bucket}.${endpoint.hostname.replace('.digitaloceanspaces.com', '.cdn.digitaloceanspaces.com')}`, '/'],
    [endpoint.hostname, `/${source.bucket}/`],
  ];
  if (source.cdnBaseUrl) {
    const cdn = new URL(source.cdnBaseUrl);
    prefixes.unshift([cdn.host, `${cdn.pathname.replace(/\/+$/, '')}/`]);
  }
  for (const [host, prefix] of prefixes) {
    if (url.host !== host || !url.pathname.startsWith(prefix)) continue;
    try {
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      return key && !key.includes('\0') ? key : null;
    } catch { return null; }
  }
  return null;
}

async function digestFile(filename) {
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filename)) { digest.update(chunk); bytes += chunk.length; }
  return { sha256: digest.digest('hex'), bytes };
}

async function copySpacesObject({ client, source, key, directory, signal,
  maxBytes = 100 * 1024 * 1024 }) {
  const object = await client.send(new GetObjectCommand({ Bucket: source.bucket, Key: key }), { abortSignal: signal });
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/avif': '.avif', 'application/pdf': '.pdf' };
  const extension = extensions[String(object.ContentType || '').split(';')[0].toLowerCase()] || '.bin';
  const folder = path.join('migrated', hash(`${source.endpoint}/${source.bucket}`).slice(0, 20));
  const targetDirectory = path.join(directory, folder);
  const temporary = path.join(targetDirectory, `.${crypto.randomUUID()}.part`);
  try {
    if (!object.Body || object.ContentLength > maxBytes) throw new Error('The object is empty or exceeds the 100 MB migration limit.');
    await fs.promises.mkdir(targetDirectory, { recursive: true });
    const digest = crypto.createHash('sha256');
    let bytes = 0;
    const verify = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error('The object exceeds the migration size limit.'));
      digest.update(chunk); callback(null, chunk);
    } });
    await pipeline(object.Body, verify, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
    const sha256 = digest.digest('hex');
    if (object.ContentLength !== undefined && bytes !== object.ContentLength) throw new Error('The downloaded file length does not match Spaces.');
    const persisted = await digestFile(temporary);
    if (persisted.sha256 !== sha256 || persisted.bytes !== bytes) throw new Error('The local file failed checksum verification.');
    const handle = await fs.promises.open(temporary, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    const name = `${sha256}${extension}`;
    const destination = path.join(targetDirectory, name);
    try { await fs.promises.link(temporary, destination); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await digestFile(destination);
      if (existing.sha256 !== sha256 || existing.bytes !== bytes) throw new Error('An existing local file failed checksum verification.');
    }
    return { url: `/uploads/${folder.split(path.sep).join('/')}/${name}`, key, sha256, bytes,
      etag: object.ETag || null, verifiedAt: new Date().toISOString() };
  } finally {
    object.Body?.destroy?.();
    await fs.promises.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

module.exports = { sourceIdentity, resolveSpacesKey, copySpacesObject, hash };
