import { describe, expect, it } from 'vitest';
import { collectLinkTargetIds } from './link-cell-value.util';
import { filterLiveLinkEntries } from './record-restore.service';

describe('collectLinkTargetIds', () => {
  it('collects ids from single and multi link cell values', () => {
    expect(collectLinkTargetIds({ id: 'recA', title: 'A' })).toEqual(['recA']);
    expect(
      collectLinkTargetIds([
        { id: 'recA', title: 'A' },
        { id: 'recB', title: 'B' },
      ])
    ).toEqual(['recA', 'recB']);
  });

  it('contributes nothing for null and unrecognized shapes', () => {
    expect(collectLinkTargetIds(null)).toEqual([]);
    expect(collectLinkTargetIds('recA')).toEqual([]);
    expect(collectLinkTargetIds([{ title: 'no id' }, 42])).toEqual([]);
  });
});

describe('filterLiveLinkEntries', () => {
  const live = (ids: string[]) => (id: string) => ids.includes(id);

  it('returns the same reference when every entry is live', () => {
    const single = { id: 'recA', title: 'A' };
    expect(filterLiveLinkEntries(single, live(['recA']))).toBe(single);

    const multi = [{ id: 'recA' }, { id: 'recB' }];
    expect(filterLiveLinkEntries(multi, live(['recA', 'recB']))).toBe(multi);
  });

  it('nulls a dead single value and filters dead entries from a multi value', () => {
    expect(filterLiveLinkEntries({ id: 'recDead' }, live([]))).toBeNull();

    expect(filterLiveLinkEntries([{ id: 'recA' }, { id: 'recDead' }], live(['recA']))).toEqual([
      { id: 'recA' },
    ]);
  });

  it('collapses a fully-dead multi value to null instead of an empty array', () => {
    expect(filterLiveLinkEntries([{ id: 'recDead' }], live([]))).toBeNull();
  });

  it('leaves unrecognized shapes untouched', () => {
    expect(filterLiveLinkEntries('recA', live([]))).toBe('recA');
    const mixed = [{ title: 'no id' }, { id: 'recA' }];
    expect(filterLiveLinkEntries(mixed, live(['recA']))).toBe(mixed);
  });
});
