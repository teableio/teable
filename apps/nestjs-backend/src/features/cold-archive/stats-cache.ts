const STATS_CACHE_MAX_ENTRIES = 512;

/**
 * Etag-keyed LRU of PARSED `_stats.json` objects.
 *
 * Every merged read consults stats more than once — a count, a boundary and a
 * scan each need them — and the flusher/compactor rewrite them from another
 * process, so a key-addressed cache could serve clobbered content. Keying by
 * etag makes it safe by construction: a rewrite changes the etag and misses.
 *
 * The lookup that supplies the etag is a LIST of the single stats key, which
 * is orders of magnitude smaller than the object itself (a month's part
 * entries), so trading a GET for a LIST pays from the second read onward.
 * Callers that already hold a fresh etag pass it and skip the LIST entirely.
 *
 * Parsed objects are cached, not bytes: the entries are handed out by
 * reference and every consumer treats stats as read-only advisory data. A
 * mutating caller (the flusher's read-modify-write) must NOT come through
 * here — it reads to rewrite, exactly the case an etag cannot protect.
 *
 * Two properties this leans on, both verified rather than assumed:
 *
 * - The etag is the object store's, not ours (S3 `ListObjectsV2` ETag, MinIO
 *   the same). The local filesystem adapter reports no etag at all, and an
 *   absent etag disables the cache by construction — every get misses and
 *   every set is a no-op — so dev/self-hosted setups simply read through.
 *
 * - A stats ENTRY is effectively immutable even though the stats FILE is
 *   rewritten in place on every flush: part keys carry a per-writer-run token
 *   and healing deletes old keys rather than overwriting them, so a key's
 *   entry never changes meaning. A stale snapshot can therefore only miss
 *   entries for freshly written keys (which then read as "no entry" and get
 *   scanned) or retain entries for deleted keys (never visited — iteration is
 *   driven by a live LIST). The failure mode is lost pruning, not wrong rows.
 *   That also covers the LIST-then-GET race: content fetched after a
 *   concurrent rewrite may be filed under the older etag, but every entry in
 *   it is still consistent with its own key.
 */
export class ColdStatsCache {
  private readonly entries = new Map<string, unknown>();
  /** key → live cacheKey; a stats rewrite must not strand the prior etag's snapshot */
  private readonly latestByKey = new Map<string, string>();

  get<TStats>(key: string, etag: string | undefined): TStats | undefined {
    if (!etag) return undefined;
    const cacheKey = `${key}@${etag}`;
    const cached = this.entries.get(cacheKey);
    if (cached === undefined) return undefined;
    // re-insert to refresh the LRU position
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, cached);
    return cached as TStats;
  }

  set(key: string, etag: string | undefined, stats: unknown): void {
    if (!etag) return;
    const cacheKey = `${key}@${etag}`;
    const previous = this.latestByKey.get(key);
    if (previous !== undefined && previous !== cacheKey) this.entries.delete(previous);
    this.latestByKey.set(key, cacheKey);
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, stats);
    while (this.entries.size > STATS_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      // etags never contain '@'; the last separator recovers the base key
      const base = oldest.value.slice(0, oldest.value.lastIndexOf('@'));
      if (this.latestByKey.get(base) === oldest.value) this.latestByKey.delete(base);
    }
  }

  /** a rewrite invalidates by etag on its own; this is for tests and resets */
  clear(): void {
    this.entries.clear();
    this.latestByKey.clear();
  }
}
