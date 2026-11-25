import { describe, expect, it } from 'vitest';
import { FieldType } from '../constant';
import {
  ALL_RELATIVE_DATE_MODES,
  DAY_RELATIVE_DATE_MODES,
  EXACT_DATE_MODES,
  MONTH_RELATIVE_DATE_MODES,
  WEEK_RELATIVE_DATE_MODES,
  analyzePeriodicRefreshSpec,
} from './periodic-refresh-analyzer';
import {
  computeBaseJitterMinute,
  computePeriodicRefreshRangeHash,
  computeScheduledRefreshDelayMs,
  getLocalDateParts,
  isFieldDueForScheduledRefresh,
  isSpecDueForScheduledRefresh,
} from './periodic-refresh-range-hash';

describe('periodic-refresh-analyzer', () => {
  it('detects all 4 volatile clock functions in formula expressions', () => {
    for (const expr of [
      'TODAY()',
      'DATETIME_FORMAT(NOW(), "MM-DD HH:mm")',
      'FROMNOW({Created}, "day")',
      'TONOW({DueDate}, "day")',
    ]) {
      const spec = analyzePeriodicRefreshSpec({
        type: FieldType.Formula,
        options: { expression: expr, timeZone: 'Asia/Shanghai' },
      });
      expect(spec.supported).toBe(true);
      if (spec.supported) {
        expect(spec.sourceType).toBe('formula');
        expect(spec.cadence).toBe('day');
        expect(spec.timeZone).toBe('Asia/Shanghai');
        expect(spec.containsNowPrecision).toBe(expr !== 'TODAY()');
      }
    }
  });

  it('ignores string literals and invalid/static formulas', () => {
    expect(
      analyzePeriodicRefreshSpec({
        type: FieldType.Formula,
        options: { expression: '"TODAY()" & "NOW()"' },
      }).supported
    ).toBe(false);

    expect(
      analyzePeriodicRefreshSpec({
        type: FieldType.Formula,
        options: { expression: '{A} + {B}' },
      }).supported
    ).toBe(false);

    expect(
      analyzePeriodicRefreshSpec({
        type: FieldType.Formula,
        options: { expression: 'TODAY(' },
      }).supported
    ).toBe(false);
  });

  it('covers all 26 relative date modes and excludes all 4 exact modes', () => {
    expect(ALL_RELATIVE_DATE_MODES.size).toBe(26);

    for (const mode of DAY_RELATIVE_DATE_MODES) {
      const spec = analyzePeriodicRefreshSpec({
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: 'fldDate1',
                operator: 'is',
                value: { mode, numberOfDays: 3, timeZone: 'America/New_York' },
              },
            ],
          },
        },
      });
      expect(spec.supported).toBe(true);
      if (spec.supported) {
        expect(spec.cadence).toBe('day');
        expect(spec.timeZone).toBe('America/New_York');
      }
    }

    for (const mode of WEEK_RELATIVE_DATE_MODES) {
      const spec = analyzePeriodicRefreshSpec({
        type: FieldType.Rollup,
        lookupOptions: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldDate1', operator: 'is', value: { mode, timeZone: 'UTC' } }],
          },
        },
      });
      expect(spec.supported && spec.cadence).toBe('week');
    }

    for (const mode of MONTH_RELATIVE_DATE_MODES) {
      const spec = analyzePeriodicRefreshSpec({
        type: FieldType.ConditionalRollup,
        options: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldDate1', operator: 'is', value: { mode, timeZone: 'UTC' } }],
          },
        },
      });
      expect(spec.supported && spec.cadence).toBe('month');
    }

    for (const mode of EXACT_DATE_MODES) {
      const spec = analyzePeriodicRefreshSpec({
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: 'fldDate1',
                operator: 'is',
                value: {
                  mode,
                  exactDate: '2026-08-18T00:00:00.000Z',
                  exactDateEnd: '2026-08-19T00:00:00.000Z',
                  timeZone: 'UTC',
                },
              },
            ],
          },
        },
      });
      expect(spec.supported).toBe(false);
    }
  });

  it('picks shortest cadence across nested filter groups and reads filterItem.value.timeZone for Lookup', () => {
    const spec = analyzePeriodicRefreshSpec({
      type: FieldType.Number,
      isLookup: true,
      isConditionalLookup: true,
      options: {}, // Lookup options schema has no field-level timeZone
      lookupOptions: {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fld1',
              operator: 'is',
              value: { mode: 'currentMonth', timeZone: 'Asia/Tokyo' },
            },
            {
              conjunction: 'or',
              filterSet: [
                {
                  fieldId: 'fld2',
                  operator: 'is',
                  value: { mode: 'today', timeZone: 'Asia/Shanghai' },
                },
              ],
            },
          ],
        },
      },
    });
    expect(spec.supported).toBe(true);
    if (spec.supported) {
      expect(spec.cadence).toBe('day');
      expect(spec.timeZone).toBe('Asia/Tokyo');
      expect(spec.relativeHits).toHaveLength(2);
    }
  });
});

describe('periodic-refresh-range-hash', () => {
  it('short-circuits monthly filters on mid-month rollover and invalidates on the 1st', () => {
    const monthRollup = {
      type: FieldType.Rollup,
      lookupOptions: {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldDate',
              operator: 'is',
              value: { mode: 'currentMonth', timeZone: 'Asia/Shanghai' },
            },
          ],
        },
      },
    };

    const aug18 = computePeriodicRefreshRangeHash(monthRollup, new Date('2026-08-18T16:05:00Z')); // Aug 19 00:05+8
    const aug19 = computePeriodicRefreshRangeHash(monthRollup, new Date('2026-08-19T16:05:00Z')); // Aug 20 00:05+8
    const sep01 = computePeriodicRefreshRangeHash(monthRollup, new Date('2026-08-31T16:05:00Z')); // Sep 01 00:05+8

    expect(aug18?.rangeHash).toBe(aug19?.rangeHash);
    expect(sep01?.rangeHash).not.toBe(aug19?.rangeHash);
  });

  it('short-circuits weekly filters Mon-Sun and invalidates on Monday', () => {
    const weekLookup = {
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        filter: {
          conjunction: 'and',
          filterSet: [
            { fieldId: 'fldDate', operator: 'is', value: { mode: 'currentWeek', timeZone: 'UTC' } },
          ],
        },
      },
    };

    // 2026-08-18 is Tuesday, 2026-08-23 is Sunday, 2026-08-24 is Monday
    const tue = computePeriodicRefreshRangeHash(weekLookup, new Date('2026-08-18T00:05:00Z'));
    const sun = computePeriodicRefreshRangeHash(weekLookup, new Date('2026-08-23T00:05:00Z'));
    const mon = computePeriodicRefreshRangeHash(weekLookup, new Date('2026-08-24T00:05:00Z'));

    expect(tue?.rangeHash).toBe(sun?.rangeHash);
    expect(mon?.rangeHash).not.toBe(sun?.rangeHash);
  });

  it('handles half/quarter-hour offsets like Asia/Kathmandu (+05:45) and jitter gates', () => {
    // 2026-08-18T18:16:00Z is 2026-08-19 00:01 in Asia/Kathmandu (+05:45)
    const parts = getLocalDateParts(new Date('2026-08-18T18:16:00Z'), 'Asia/Kathmandu');
    expect(parts.localDate).toBe('2026-08-19');
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(1);

    const baseId = 'bseTestKathmandu01';
    const jitter = computeBaseJitterMinute(baseId);
    expect(jitter).toBeGreaterThanOrEqual(0);
    expect(jitter).toBeLessThan(15);

    // At 00:20 local time (past any jitter 0..14), must be due if last date was 08-18
    expect(
      isFieldDueForScheduledRefresh({
        now: new Date('2026-08-18T18:35:00Z'),
        timeZone: 'Asia/Kathmandu',
        lastRefreshedLocalDate: '2026-08-18',
        baseId,
      })
    ).toBe(true);

    // Already refreshed on 08-19 -> not due again same day
    expect(
      isFieldDueForScheduledRefresh({
        now: new Date('2026-08-18T18:35:00Z'),
        timeZone: 'Asia/Kathmandu',
        lastRefreshedLocalDate: '2026-08-19',
        baseId,
      })
    ).toBe(false);
  });

  it('triggers overseas America/New_York midnights across DST (EDT UTC-4) and standard time (EST UTC-5)', () => {
    const baseId = 'bseOverseasNy001';

    // DST (EDT, UTC-4): 2026-08-19T03:50:00Z = 2026-08-18 23:50 EDT (not yet midnight)
    expect(
      isFieldDueForScheduledRefresh({
        now: new Date('2026-08-19T03:50:00Z'),
        timeZone: 'America/New_York',
        lastRefreshedLocalDate: '2026-08-18',
        baseId,
      })
    ).toBe(false);

    // 2026-08-19T04:20:00Z = 2026-08-19 00:20 EDT (12:20 Asia/Shanghai) -> due in NY
    expect(
      isFieldDueForScheduledRefresh({
        now: new Date('2026-08-19T04:20:00Z'),
        timeZone: 'America/New_York',
        lastRefreshedLocalDate: '2026-08-18',
        baseId,
      })
    ).toBe(true);

    // Standard time (EST, UTC-5): 2026-11-23T04:50:00Z = 2026-11-22 23:50 EST -> not due yet
    expect(
      isFieldDueForScheduledRefresh({
        now: new Date('2026-11-23T04:50:00Z'),
        timeZone: 'America/New_York',
        lastRefreshedLocalDate: '2026-11-22',
        baseId,
      })
    ).toBe(false);

    // 2026-11-23T05:20:00Z = 2026-11-23 00:20 EST (13:20 Asia/Shanghai) -> due in NY
    expect(
      isFieldDueForScheduledRefresh({
        now: new Date('2026-11-23T05:20:00Z'),
        timeZone: 'America/New_York',
        lastRefreshedLocalDate: '2026-11-22',
        baseId,
      })
    ).toBe(true);
  });

  it('re-triggers multi-timezone filter groups when a secondary timezone crosses midnight', () => {
    const baseId = 'bseMultiTzFilter1';
    const fieldInput = {
      type: FieldType.Number,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldTokyo',
              operator: 'is',
              value: { mode: 'today', timeZone: 'Asia/Tokyo' },
            },
            {
              fieldId: 'fldNewYork',
              operator: 'is',
              value: { mode: 'today', timeZone: 'America/New_York' },
            },
          ],
        },
      },
    };
    const spec = analyzePeriodicRefreshSpec(fieldInput);
    expect(spec.supported).toBe(true);
    if (!spec.supported) return;

    // 1. Tokyo midnight: 2026-08-18T15:20:00Z = Tokyo 2026-08-19 00:20, NY 2026-08-18 11:20
    const tokyoMidnight = new Date('2026-08-18T15:20:00Z');
    const hashAtTokyoMidnight = computePeriodicRefreshRangeHash(fieldInput, tokyoMidnight)!;
    expect(
      isSpecDueForScheduledRefresh({
        field: fieldInput,
        spec,
        now: tokyoMidnight,
        lastRefreshedLocalDate: '2026-08-18',
        lastRangeHash: 'prev-hash',
        baseId,
      })
    ).toBe(true);

    // 2. Mid-day after Tokyo refresh: 2026-08-18T20:00:00Z = Tokyo 2026-08-19 05:00, NY 2026-08-18 16:00
    expect(
      isSpecDueForScheduledRefresh({
        field: fieldInput,
        spec,
        now: new Date('2026-08-18T20:00:00Z'),
        lastRefreshedLocalDate: hashAtTokyoMidnight.localDate,
        lastRangeHash: hashAtTokyoMidnight.rangeHash,
        baseId,
      })
    ).toBe(false);

    // 3. New York midnight while Tokyo is still on 2026-08-19 (13:20 Tokyo, 00:20 EDT NY)
    const nyMidnight = new Date('2026-08-19T04:20:00Z');
    const hashAtNyMidnight = computePeriodicRefreshRangeHash(fieldInput, nyMidnight)!;
    expect(hashAtNyMidnight.rangeHash).not.toBe(hashAtTokyoMidnight.rangeHash);
    expect(
      isSpecDueForScheduledRefresh({
        field: fieldInput,
        spec,
        now: nyMidnight,
        lastRefreshedLocalDate: hashAtTokyoMidnight.localDate, // still '2026-08-19' in Tokyo
        lastRangeHash: hashAtTokyoMidnight.rangeHash,
        baseId,
      })
    ).toBe(true);

    // 4. After NY refresh updates rangeHash, same day no longer re-triggers
    expect(
      isSpecDueForScheduledRefresh({
        field: fieldInput,
        spec,
        now: new Date('2026-08-19T05:00:00Z'),
        lastRefreshedLocalDate: hashAtTokyoMidnight.localDate,
        lastRangeHash: hashAtNyMidnight.rangeHash,
        baseId,
      })
    ).toBe(false);
  });

  it('computes exact per-minute midnight jitter delays across timezones', () => {
    // Pick a baseId whose deterministic jitter minute is > 0
    let targetBaseId = 'bseJitterCheck001';
    for (let i = 0; i < 50; i += 1) {
      const candidate = `bseJitterCheck${i}`;
      if (computeBaseJitterMinute(candidate) >= 3) {
        targetBaseId = candidate;
        break;
      }
    }
    const jitter = computeBaseJitterMinute(targetBaseId);
    expect(jitter).toBeGreaterThanOrEqual(3);
    expect(jitter).toBeLessThan(15);

    const fieldInput = {
      type: FieldType.Formula,
      options: { expression: 'TODAY()', timeZone: 'Asia/Kathmandu' },
    };
    const spec = analyzePeriodicRefreshSpec(fieldInput);
    expect(spec.supported).toBe(true);
    if (!spec.supported) return;

    // 2026-08-18T18:15:00.000Z is 2026-08-19 00:00:00 in Asia/Kathmandu (+05:45)
    expect(
      computeScheduledRefreshDelayMs({
        field: fieldInput,
        spec,
        now: new Date('2026-08-18T18:15:00.000Z'),
        lastRefreshedLocalDate: '2026-08-18',
        baseId: targetBaseId,
      })
    ).toBe(jitter * 60_000);

    // At 00:<jitter>:00 Kathmandu time, delay becomes 0 (execute immediately)
    const afterJitterUtc = new Date(Date.parse('2026-08-18T18:15:00.000Z') + jitter * 60_000);
    expect(
      computeScheduledRefreshDelayMs({
        field: fieldInput,
        spec,
        now: afterJitterUtc,
        lastRefreshedLocalDate: '2026-08-18',
        baseId: targetBaseId,
      })
    ).toBe(0);

    // Once refreshed on 2026-08-19, returns null (not due)
    expect(
      computeScheduledRefreshDelayMs({
        field: fieldInput,
        spec,
        now: afterJitterUtc,
        lastRefreshedLocalDate: '2026-08-19',
        baseId: targetBaseId,
      })
    ).toBeNull();

    // Multi-day filter (currentMonth) also returns null on subsequent days when lastRangeHash matches
    const monthInput = {
      type: FieldType.Rollup,
      lookupOptions: {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldDate',
              operator: 'is',
              value: { mode: 'currentMonth', timeZone: 'UTC' },
            },
          ],
        },
      },
    };
    const monthSpec = analyzePeriodicRefreshSpec(monthInput);
    const sep1Hash = computePeriodicRefreshRangeHash(
      monthInput,
      new Date('2026-09-01T00:30:00.000Z')
    )!.rangeHash;
    expect(
      computeScheduledRefreshDelayMs({
        field: monthInput,
        spec: monthSpec,
        now: new Date('2026-09-15T00:05:00.000Z'),
        lastRefreshedLocalDate: '2026-09-01',
        lastRangeHash: sep1Hash,
        baseId: targetBaseId,
      })
    ).toBeNull();
  });
});
