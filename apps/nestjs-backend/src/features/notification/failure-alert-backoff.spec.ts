import { describe, expect, it } from 'vitest';
import {
  FAILURE_ALERT_PER_RUN_LIMIT,
  isFailureStreakSummary,
  shouldSendFailureNotification,
} from './failure-alert-backoff';

describe('failure alert backoff', () => {
  it('alerts on every one of the first failures, then on the documented ladder', () => {
    const alerting = Array.from({ length: 1400 }, (_, i) => i + 1).filter(
      shouldSendFailureNotification
    );

    expect(alerting).toEqual([1, 2, 3, 4, 5, 10, 20, 40, 80, 160, 320, 640, 1280]);
  });

  it('says nothing between the per-run limit and the first backoff rung', () => {
    expect(shouldSendFailureNotification(FAILURE_ALERT_PER_RUN_LIMIT)).toBe(true);
    expect(shouldSendFailureNotification(FAILURE_ALERT_PER_RUN_LIMIT + 1)).toBe(false);
    expect(shouldSendFailureNotification(9)).toBe(false);
    expect(shouldSendFailureNotification(10)).toBe(true);
  });

  it('switches to streak wording exactly where per-failure alerting stops', () => {
    expect(isFailureStreakSummary(FAILURE_ALERT_PER_RUN_LIMIT)).toBe(false);
    expect(isFailureStreakSummary(FAILURE_ALERT_PER_RUN_LIMIT + 1)).toBe(true);
  });
});
