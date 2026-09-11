import { describe, expect, it } from 'vitest';

import { TableQueryObservationWindow, TableQueryShape } from './domain';
import { decideObservationPersist } from './observationPersistPolicy';

const windowStart = new Date('2026-08-27T12:00:00.000Z');

const observation = (input: {
  readonly requestCount?: number;
  readonly slowCount?: number;
  readonly timeoutCount?: number;
  readonly dbErrorCount?: number;
}): TableQueryObservationWindow => {
  const requestCount = input.requestCount ?? 1;
  const shape = TableQueryShape.create({
    queryKind: 'recordList',
    executionShape: { durationMs: 10, timedOut: false, resultCountBucket: 'small' },
  })._unsafeUnwrap();
  return TableQueryObservationWindow.create({
    baseId: 'bse-policy',
    tableId: 'tbl-policy',
    windowStart,
    windowSizeSeconds: 300,
    shape,
    requestCount,
    slowCount: input.slowCount ?? 0,
    timeoutCount: input.timeoutCount ?? 0,
    dbErrorCount: input.dbErrorCount ?? 0,
    totalDurationMs: 10 * requestCount,
    maxDurationMs: 10,
  })._unsafeUnwrap();
};

describe('decideObservationPersist', () => {
  it('keeps an open window that is not yet interesting', () => {
    expect(
      decideObservationPersist(
        observation({ requestCount: 3 }),
        new Date('2026-08-27T12:04:59.000Z')
      )
    ).toBe('keep');
  });

  it('drops a closed window that never became interesting', () => {
    expect(
      decideObservationPersist(
        observation({ requestCount: 3 }),
        new Date('2026-08-27T12:05:00.000Z')
      )
    ).toBe('drop');
  });

  it('persists slow, timeout, or db-error windows immediately', () => {
    const now = new Date('2026-08-27T12:00:01.000Z');
    expect(decideObservationPersist(observation({ slowCount: 1 }), now)).toBe('persist');
    expect(decideObservationPersist(observation({ timeoutCount: 1 }), now)).toBe('persist');
    expect(decideObservationPersist(observation({ dbErrorCount: 1 }), now)).toBe('persist');
  });

  it('persists a hot window once request count reaches the threshold', () => {
    expect(
      decideObservationPersist(
        observation({ requestCount: 10 }),
        new Date('2026-08-27T12:00:01.000Z')
      )
    ).toBe('persist');
  });
});
