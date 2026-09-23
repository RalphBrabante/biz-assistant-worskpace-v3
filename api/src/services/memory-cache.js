// Serialized values prevent callers from mutating a cached response. The byte
// budget covers keys/payloads; maxEntries also bounds Map/object overhead.
class MemoryCache {
  constructor({ maxEntries, maxBytes, maxEntryBytes, now = Date.now }) {
    Object.assign(this, { maxEntries, maxBytes, maxEntryBytes, now });
    this.entries = new Map();
    this.bytes = 0;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.delete(key);
    }
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.payload;
  }

  set(key, payload, ttlSeconds) {
    this.delete(key);
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(payload);
    if (bytes > this.maxEntryBytes || bytes > this.maxBytes || ttlSeconds <= 0) return;
    this.prune();
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, { payload, bytes, expiresAt: this.now() + ttlSeconds * 1000 });
    this.bytes += bytes;
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

module.exports = { MemoryCache };
