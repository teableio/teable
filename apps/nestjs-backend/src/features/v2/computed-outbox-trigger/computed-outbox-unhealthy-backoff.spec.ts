import { describe, expect, it } from 'vitest';

import {
  isJobAlreadyExistsError,
  isUnhealthyByodbSentinel,
  nextUnhealthyByodbDefer,
  resolveUnhealthyByodbOrigin,
  UNHEALTHY_BYODB_BACKOFF_MS,
} from './computed-outbox-unhealthy-backoff';

describe('nextUnhealthyByodbDefer', () => {
  const baseId = 'bse1234567890123456';
  const origin = new Date('2026-01-05T12:00:00Z');

  it('starts at 1 minute from the health-changed origin', () => {
    const defer = nextUnhealthyByodbDefer(baseId, origin, origin.getTime());
    expect(defer).toEqual({
      step: 0,
      availableAt: new Date('2026-01-05T12:01:00Z'),
      wakeupId: `cuwd-ro-${baseId}-s0`,
    });
  });

  it('walks 1m → 5m → 15m → 30m → 60m from the same origin', () => {
    const expected = [
      ['2026-01-05T12:01:00.001Z', 1, '2026-01-05T12:05:00Z'],
      ['2026-01-05T12:05:00.001Z', 2, '2026-01-05T12:15:00Z'],
      ['2026-01-05T12:15:00.001Z', 3, '2026-01-05T12:30:00Z'],
      ['2026-01-05T12:30:00.001Z', 4, '2026-01-05T13:00:00Z'],
    ] as const;
    for (const [now, step, availableAt] of expected) {
      expect(nextUnhealthyByodbDefer(baseId, origin, new Date(now).getTime())).toEqual({
        step,
        availableAt: new Date(availableAt),
        wakeupId: `cuwd-ro-${baseId}-s${step}`,
      });
    }
  });

  it('repeats the 60-minute cap after the ramp', () => {
    const defer = nextUnhealthyByodbDefer(
      baseId,
      origin,
      new Date('2026-01-05T13:00:00.001Z').getTime()
    );
    expect(defer.step).toBe(5);
    expect(defer.availableAt).toEqual(new Date('2026-01-05T14:00:00Z'));
    expect(UNHEALTHY_BYODB_BACKOFF_MS[UNHEALTHY_BYODB_BACKOFF_MS.length - 1]).toBe(60 * 60_000);
  });

  it('aligns a missing origin to the current UTC minute so concurrent tasks share a job', () => {
    const nowMs = new Date('2026-01-05T12:00:34Z').getTime();
    expect(resolveUnhealthyByodbOrigin(null, nowMs)).toEqual(new Date('2026-01-05T12:00:00Z'));
    const first = nextUnhealthyByodbDefer(baseId, null, nowMs);
    const second = nextUnhealthyByodbDefer(baseId, null, nowMs + 800);
    expect(first.wakeupId).toBe(second.wakeupId);
    expect(first.availableAt).toEqual(second.availableAt);
  });

  it('identifies per-base sentinel locators', () => {
    expect(isUnhealthyByodbSentinel(`cuwd-ro-${baseId}-s0`, baseId)).toBe(true);
    expect(isUnhealthyByodbSentinel('cuw1234567890123456', baseId)).toBe(false);
    expect(isUnhealthyByodbSentinel(`cuwd-ro-bseother-s0`, baseId)).toBe(false);
  });

  it('treats BullMQ duplicate jobId failures as already-scheduled', () => {
    expect(
      isJobAlreadyExistsError(
        Object.assign(new Error('Job already exists'), { name: 'JobIdAlreadyExistsError' })
      )
    ).toBe(true);
    expect(isJobAlreadyExistsError(new Error('Job xyz is already in queue'))).toBe(true);
    expect(isJobAlreadyExistsError(new Error('redis unavailable'))).toBe(false);
  });
});
