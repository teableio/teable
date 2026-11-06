import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const parseNumericResult = (value: string | null): number => {
  expect(value).not.toBeNull();
  const parsed = Number(value);
  expect(Number.isFinite(parsed)).toBe(true);
  return parsed;
};

describe('DATETIME_DIFF parity', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, [
      {
        name: 'DiffDefaultUnit',
        expression: 'DATETIME_DIFF("2024-01-03T00:00:00Z", "2024-01-01T00:00:00Z")',
      },
      {
        name: 'DiffExplicitDay',
        expression: 'DATETIME_DIFF("2024-01-03T00:00:00Z", "2024-01-01T00:00:00Z", "day")',
      },
      {
        name: 'DiffSubSecondPositiveDay',
        expression: 'DATETIME_DIFF("2024-01-01T00:00:00.500Z", "2024-01-01T00:00:00.000Z", "day")',
      },
      {
        name: 'DiffSubSecondNegativeDay',
        expression: 'DATETIME_DIFF("2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.500Z", "day")',
      },
      {
        name: 'DiffSubSecondFloatDay',
        expression:
          'DATETIME_DIFF("2024-01-01T00:00:00.500Z", "2024-01-01T00:00:00.000Z", "day", TRUE)',
      },
      {
        name: 'DiffMinuteShorthand',
        expression: 'DATETIME_DIFF("2024-01-01T01:30:00.000Z", "2024-01-01T00:00:00.000Z", "m")',
      },
    ]);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('defaults DATETIME_DIFF unit to second when omitted', async () => {
    const [defaultContext, explicitDayContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'DiffDefaultUnit'),
      buildFormulaSnapshotContext(testTable, 'DiffExplicitDay'),
    ]);

    expect(defaultContext.sql).toContain('EXTRACT(EPOCH FROM');

    const defaultValue = parseNumericResult(defaultContext.result);
    const explicitDayValue = parseNumericResult(explicitDayContext.result);

    expect(defaultValue).toBeCloseTo(172800, 10);
    expect(explicitDayValue).toBeCloseTo(2, 10);
  });

  it('returns zero for day unit when datetime difference is sub-second', async () => {
    const [positiveContext, negativeContext] = await Promise.all([
      buildFormulaSnapshotContext(testTable, 'DiffSubSecondPositiveDay'),
      buildFormulaSnapshotContext(testTable, 'DiffSubSecondNegativeDay'),
    ]);

    expect(parseNumericResult(positiveContext.result)).toBeCloseTo(0, 10);
    expect(parseNumericResult(negativeContext.result)).toBeCloseTo(0, 10);
    const floatContext = await buildFormulaSnapshotContext(testTable, 'DiffSubSecondFloatDay');
    expect(parseNumericResult(floatContext.result)).toBeCloseTo(0.5 / 86400, 12);
  });

  it('supports minute shorthand unit "m"', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'DiffMinuteShorthand');

    expect(context.sql).toContain('/ 60');
    expect(parseNumericResult(context.result)).toBeCloseTo(90, 10);
  });

  it.each([
    {
      zone: 'America/Chicago',
      intervals: [
        ['2026-03-08T06:00:00Z', '2026-03-09T05:00:00Z', 1],
        ['2026-03-01T06:00:00Z', '2026-03-31T05:00:00Z', 30],
        ['2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z', 1],
        ['2026-03-07T18:00:00Z', '2026-03-08T16:00:00Z', 23 / 24],
        ['2026-10-31T17:00:00Z', '2026-11-01T17:00:00Z', 23 / 24],
        // Repeated 01:30 at fall-back has zero wall-clock difference.
        ['2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z', 0],
        // Missing spring hour: 01:30 -> 03:30 counts two local hours.
        ['2026-03-08T07:30:00Z', '2026-03-08T08:30:00Z', 2 / 24],
      ],
    },
    {
      zone: 'Australia/Lord_Howe',
      intervals: [
        ['2026-10-03T13:30:00Z', '2026-10-04T13:00:00Z', 1],
        ['2026-04-04T13:00:00Z', '2026-04-05T13:30:00Z', 1],
        ['2026-10-03T01:30:00Z', '2026-10-04T00:30:00Z', 23.5 / 24],
      ],
    },
  ])('matches dayjs offset-adjusted day units in $zone', async ({ zone, intervals }) => {
    const cases = intervals.flatMap(([start, end, days], index) =>
      [1, -1].flatMap((direction) => {
        const args = direction === 1 ? `"${end}", "${start}"` : `"${start}", "${end}"`;
        const expected = Number(days) * direction;
        return [
          {
            name: `Whole${index}_${direction === 1 ? 'Forward' : 'Reverse'}`,
            expression: `DATETIME_DIFF(${args}, "day")`,
            expected: Math.trunc(expected) || 0,
          },
          {
            name: `Float${index}_${direction === 1 ? 'Forward' : 'Reverse'}`,
            expression: `DATETIME_DIFF(${args}, "days", TRUE)`,
            expected: expected || 0,
          },
        ];
      })
    );
    const table = await createFormulaTestTable(container, cases, {
      profile: 'minimal',
      formulaTimeZone: zone,
    });
    for (const testCase of cases) {
      const context = await buildFormulaSnapshotContext(table, testCase.name);
      expect(parseNumericResult(context.result), testCase.name).toBeCloseTo(testCase.expected, 10);
    }
  });
});
