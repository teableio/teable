import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isStaleTableAnchor,
  locallyDeletedRemainingMs,
  markTableDeletedLocally,
  unmarkTableDeletedLocally,
  wasTableDeletedLocally,
} from './stale-table-fallback';

describe('isStaleTableAnchor', () => {
  const baseId = 'bseA';

  it('suspects an anchor missing from a loaded list', () => {
    expect(
      isStaleTableAnchor({
        tables: [{ id: 'tblA', baseId }],
        baseId,
        tableId: 'tblGone',
      })
    ).toBe(true);
  });

  it('does not suspect an anchor present in the list', () => {
    expect(
      isStaleTableAnchor({
        tables: [{ id: 'tblA', baseId }],
        baseId,
        tableId: 'tblA',
      })
    ).toBe(false);
  });

  it('never judges against an empty list', () => {
    expect(isStaleTableAnchor({ tables: [], baseId, tableId: 'tblA' })).toBe(false);
  });

  it('never judges against instances seeded without a baseId', () => {
    expect(
      isStaleTableAnchor({
        tables: [{ id: 'tblA' }],
        baseId,
        tableId: 'tblGone',
      })
    ).toBe(false);
  });

  it("never judges against another base's instances mid switch", () => {
    expect(
      isStaleTableAnchor({
        tables: [{ id: 'tblA', baseId: 'bseOther' }],
        baseId,
        tableId: 'tblGone',
      })
    ).toBe(false);
  });

  it('requires an anchor to judge', () => {
    expect(
      isStaleTableAnchor({ tables: [{ id: 'tblA', baseId }], baseId, tableId: undefined })
    ).toBe(false);
    expect(
      isStaleTableAnchor({ tables: [{ id: 'tblA', baseId }], baseId: undefined, tableId: 'tblA' })
    ).toBe(false);
  });
});

describe('locally deleted table marks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    unmarkTableDeletedLocally('tblMine');
    vi.useRealTimers();
  });

  it('remembers a locally issued deletion', () => {
    expect(wasTableDeletedLocally('tblMine')).toBe(false);
    markTableDeletedLocally('tblMine');
    expect(wasTableDeletedLocally('tblMine')).toBe(true);
    expect(wasTableDeletedLocally('tblOther')).toBe(false);
  });

  it('forgets the mark when the deletion request failed', () => {
    markTableDeletedLocally('tblMine');
    unmarkTableDeletedLocally('tblMine');
    expect(wasTableDeletedLocally('tblMine')).toBe(false);
  });

  it('expires the mark after the TTL', () => {
    markTableDeletedLocally('tblMine');
    vi.advanceTimersByTime(29_000);
    expect(wasTableDeletedLocally('tblMine')).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(wasTableDeletedLocally('tblMine')).toBe(false);
  });

  it('re-marking refreshes the TTL', () => {
    markTableDeletedLocally('tblMine');
    vi.advanceTimersByTime(20_000);
    markTableDeletedLocally('tblMine');
    vi.advanceTimersByTime(20_000);
    expect(wasTableDeletedLocally('tblMine')).toBe(true);
  });

  it('reports how long the mark still suppresses recovery', () => {
    expect(locallyDeletedRemainingMs('tblMine')).toBe(0);
    markTableDeletedLocally('tblMine');
    vi.advanceTimersByTime(10_000);
    expect(locallyDeletedRemainingMs('tblMine')).toBe(20_000);
    vi.advanceTimersByTime(30_000);
    expect(locallyDeletedRemainingMs('tblMine')).toBe(0);
  });
});
