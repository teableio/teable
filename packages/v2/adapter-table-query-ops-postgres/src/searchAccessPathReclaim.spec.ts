import { describe, expect, it } from 'vitest';

import { calculateIndexScanDelta, reclaimDropClaimExpiredBefore } from './searchAccessPathReclaim';

describe('calculateIndexScanDelta', () => {
  it('treats a PostgreSQL stats reset as unknown usage evidence', () => {
    expect(calculateIndexScanDelta(42, 3)).toBeUndefined();
  });

  it('returns the observed scan delta when the counter is monotonic', () => {
    expect(calculateIndexScanDelta(42, 45)).toBe(3);
  });
});

describe('reclaimDropClaimExpiredBefore', () => {
  it('makes abandoned due-drop claims retryable after one sweep interval', () => {
    expect(reclaimDropClaimExpiredBefore(new Date('2026-08-22T00:00:00Z'))).toEqual(
      new Date('2026-08-21T00:00:00Z')
    );
  });
});
