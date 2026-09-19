import { describe, expect, it } from 'vitest';
import { groupPartsByMonth } from './compaction';

const part = (yyyymm: string, seq: number, kind: 'day' | 'month' = 'day') => ({
  key: `root/tbl/${yyyymm}/${kind === 'day' ? '01' : 'm'}-p${seq}.ndjson.zst`,
  yyyymm,
  kind,
  seq,
  ...(kind === 'day' ? { dd: '01' } : {}),
});

describe('groupPartsByMonth', () => {
  it('groups a table-wide listing by month, newest month first', () => {
    const grouped = groupPartsByMonth([
      part('202605', 0),
      part('202607', 0, 'month'),
      part('202605', 1),
      part('202606', 0),
    ]);
    expect([...grouped.keys()]).toEqual(['202607', '202606', '202605']);
    expect(grouped.get('202605')?.map((item) => item.seq)).toEqual([0, 1]);
    expect(grouped.get('202607')?.map((item) => item.kind)).toEqual(['month']);
  });

  it('is empty for an empty listing', () => {
    expect(groupPartsByMonth([]).size).toBe(0);
  });
});
