import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./TableQueryOpsLive.ts', import.meta.url)),
  'utf8'
);
const normalizedSource = source.replace(/\s+/g, ' ');

describe('TableQueryOpsLive observation shard reads T7019', () => {
  it('requires the shard table and has no legacy observation table reads', () => {
    expect(source).toContain("to_regclass('table_query_observation_shard') IS NOT NULL");
    expect(source).not.toContain('table_query_observation_window');
  });

  it('deduplicates logical windows while summing writer shard metrics', () => {
    expect(normalizedSource).toContain(
      'count(DISTINCT (ow.table_id, ow.query_kind, ow.shape_hash, ow.window_start)) FROM table_query_observation_shard ow'
    );
    expect(normalizedSource).toContain(
      'coalesce(sum(ow.request_count), 0) FROM table_query_observation_shard ow'
    );
    expect(normalizedSource).toContain(
      'coalesce(sum(ow.slow_count), 0) FROM table_query_observation_shard ow'
    );
  });

  it('keeps hot-table rows grouped by table with shard sums and maxima', () => {
    expect(normalizedSource).toContain(
      'sum(ow.request_count) AS request_count, sum(ow.slow_count) AS slow_count, sum(ow.timeout_count) AS timeout_count, sum(ow.db_error_count) AS db_error_count, max(ow.max_duration_ms) AS max_duration_ms, max(ow.window_start) AS latest_window_start FROM table_query_observation_shard ow'
    );
    expect(normalizedSource).toContain(
      'GROUP BY coalesce(ow.space_id, b.space_id), ow.base_id, ow.table_id'
    );
  });
});
