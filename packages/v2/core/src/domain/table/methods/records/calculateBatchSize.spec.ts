import { describe, expect, it } from 'vitest';

import { calculateBatchSize } from './calculateBatchSize';

describe('calculateBatchSize', () => {
  it('keeps the default stream cap at 500 rows', () => {
    expect(calculateBatchSize(20)).toBe(500);
  });

  it('allows 1k-row batches for narrow mixed-field explicit updates', () => {
    expect(calculateBatchSize(20, { maxBatchSize: 1000 })).toBe(1000);
  });

  it('scales down wide-table batches with per-row SQL overhead', () => {
    expect(calculateBatchSize(100, { maxBatchSize: 1000 })).toBe(555);
    expect(calculateBatchSize(200)).toBe(288);
  });

  it('clamps explicit batch sizes to the supported range', () => {
    expect(calculateBatchSize(20, { userBatchSize: 10_000, maxBatchSize: 1000 })).toBe(1000);
    expect(calculateBatchSize(20, 1)).toBe(100);
  });
});
