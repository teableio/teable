import { describe, expect, it } from 'vitest';

import { recordPageProbeLimit, resolveRecordPageBoundary } from './RecordPageBoundary';

describe('resolveRecordPageBoundary', () => {
  it('reports a full page with no probe row as the end of the list', () => {
    const boundary = resolveRecordPageBoundary(['a', 'b', 'c'], 3);
    expect(boundary.page).toEqual(['a', 'b', 'c']);
    expect(boundary.hasMore).toBe(false);
  });

  it('drops the probe row and reports a successor', () => {
    const boundary = resolveRecordPageBoundary(['a', 'b', 'c', 'd'], 3);
    expect(boundary.page).toEqual(['a', 'b', 'c']);
    expect(boundary.hasMore).toBe(true);
  });

  it('leaves unpaginated reads untouched', () => {
    const boundary = resolveRecordPageBoundary(['a', 'b'], undefined);
    expect(boundary.page).toEqual(['a', 'b']);
    expect(boundary.hasMore).toBe(false);
  });
});

describe('recordPageProbeLimit', () => {
  it('asks for one row beyond the page, or nothing when unpaginated', () => {
    expect(recordPageProbeLimit(100)).toBe(101);
    expect(recordPageProbeLimit(undefined)).toBeUndefined();
  });
});
