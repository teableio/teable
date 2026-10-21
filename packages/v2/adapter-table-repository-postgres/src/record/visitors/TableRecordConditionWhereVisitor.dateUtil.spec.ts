import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DateUtil } from './TableRecordConditionWhereVisitor';

/**
 * Regression tests for the zero-offset timezone bug (T6520).
 *
 * dayjs's timezone plugin stores the zone offset in a field that later code
 * checks for truthiness, so instances whose current offset is exactly 0
 * (UTC, Etc/GMT) computed startOf/endOf against the host-local calendar,
 * making filter date ranges host-timezone-dependent. The host timezone is
 * forced to a non-UTC zone here so the failure mode is reproducible on UTC
 * CI hosts too.
 */
describe('DateUtil zero-offset timezones', () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    // Fixed +07:00 zone without DST — Node re-reads TZ per Date operation
    process.env.TZ = 'Asia/Bangkok';
    expect(new Date().getTimezoneOffset()).toBe(-420);
  });

  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it.each(['UTC', 'Etc/UTC', 'Etc/GMT'])(
    'computes day boundaries on the UTC calendar for %s',
    (zone) => {
      const dateUtil = new DateUtil(zone);
      const startOfDay = dateUtil.date().startOf('day');
      expect(startOfDay.toISOString()).toMatch(/T00:00:00\.000Z$/);

      const nextDayEnd = dateUtil.offset('day', 1, startOfDay).endOf('day');
      expect(nextDayEnd.toISOString()).toMatch(/T23:59:59\.999Z$/);
      // the end bound must land one calendar day after the start, not collapse back
      expect(nextDayEnd.diff(startOfDay, 'hour')).toBe(47);
    }
  );

  it('keeps zone-local day boundaries for non-zero-offset timezones', () => {
    const dateUtil = new DateUtil('Asia/Tokyo');
    const startOfDay = dateUtil.date().startOf('day');
    // Tokyo midnight is 15:00 UTC of the previous day
    expect(startOfDay.toISOString()).toMatch(/T15:00:00\.000Z$/);

    const nextDayEnd = dateUtil.offset('day', 1, startOfDay).endOf('day');
    expect(nextDayEnd.diff(startOfDay, 'hour')).toBe(47);
  });

  it('parses explicit values onto the UTC calendar for zero-offset zones', () => {
    const dateUtil = new DateUtil('UTC');
    const parsed = dateUtil.date('2026-06-10T05:30:00.000Z');
    expect(parsed.startOf('day').toISOString()).toBe('2026-06-10T00:00:00.000Z');
    expect(parsed.endOf('day').toISOString()).toBe('2026-06-10T23:59:59.999Z');
  });

  it('restores the IANA zone when an offset crosses into daylight saving time', () => {
    const dateUtil = new DateUtil('Europe/London');
    const winter = dateUtil.date('2026-03-15T12:00:00.000Z');

    expect(winter.utcOffset()).toBe(0);

    const summer = dateUtil.offset('month', 1, winter);
    expect(summer.utcOffset()).toBe(60);
    expect(summer.format('HH:mm')).toBe('12:00');
    expect(summer.startOf('month').toISOString()).toBe('2026-03-31T23:00:00.000Z');
    expect(summer.endOf('month').toISOString()).toBe('2026-04-30T22:59:59.999Z');
  });
});
