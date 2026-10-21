import { describe, expect, it } from 'vitest';
import { ColdStatsCache } from './stats-cache';

describe('ColdStatsCache', () => {
  it('serves a snapshot back by key and etag, and disables itself without one', () => {
    const cache = new ColdStatsCache();
    cache.set('root/a/_stats.json', 'e1', { rows: 1 });
    expect(cache.get('root/a/_stats.json', 'e1')).toEqual({ rows: 1 });
    expect(cache.get('root/a/_stats.json', 'e2')).toBeUndefined();
    expect(cache.get('root/a/_stats.json', undefined)).toBeUndefined();
  });

  it('a rewrite evicts the previous etag instead of stranding it until LRU pressure', () => {
    const cache = new ColdStatsCache();
    cache.set('root/a/_stats.json', 'e1', { rows: 1 });
    cache.set('root/b/_stats.json', 'e1', { rows: 9 });
    cache.set('root/a/_stats.json', 'e2', { rows: 2 });
    expect(cache.get('root/a/_stats.json', 'e1')).toBeUndefined();
    expect(cache.get('root/a/_stats.json', 'e2')).toEqual({ rows: 2 });
    expect(cache.get('root/b/_stats.json', 'e1')).toEqual({ rows: 9 });
  });
});
