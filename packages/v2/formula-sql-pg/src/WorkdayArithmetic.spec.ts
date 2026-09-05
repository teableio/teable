import { createV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import { FunctionName } from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FormulaSqlPgFunctions } from './FormulaSqlPgFunctions';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import { legacyWorkdayDiffSql, legacyWorkdaySql } from './testkit/LegacyWorkdaySql';

const compile = (name: FunctionName, timeZone = 'utc') => {
  const functions = new FormulaSqlPgFunctions({
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    timeZone,
  } as FormulaSqlPgTranslator);
  const handler = functions.getHandlers()[name];
  if (!handler) throw new Error(`Missing handler: ${name}`);
  return handler([
    makeExpr('c.start_date::timestamp', 'datetime'),
    name === FunctionName.Workday
      ? makeExpr('c.day_count', 'number')
      : makeExpr('c.end_date::timestamp', 'datetime'),
    makeExpr('c.holiday_text', 'string'),
  ]).valueSql;
};

describe('workday arithmetic differential regression', () => {
  let db: Kysely<unknown>;
  beforeAll(async () => {
    db = await createV2PostgresPgliteDb({ pg: { connectionString: 'memory://' } });
  });
  afterAll(async () => db?.destroy());

  const compare = async (cases: string, name: FunctionName, baseline: string) => {
    const result = await sql
      .raw(
        `WITH cases AS (${cases})
      SELECT * FROM (
        SELECT c.*, ${compile(name)} AS actual, ${baseline} AS expected
        FROM cases c
      ) results WHERE actual IS DISTINCT FROM expected LIMIT 10`
      )
      .execute(db);
    expect(result.rows).toEqual([]);
  };

  it('matches enumeration for every weekday, both directions, fractions, blanks and holidays', async () => {
    await compare(
      `SELECT DATE '2024-02-24' + d AS start_date,
      n::numeric + f AS day_count, h AS holiday_text
      FROM generate_series(0, 13) d CROSS JOIN generate_series(-16, 16) n
      CROSS JOIN (VALUES (0), (0.49), (0.5)) fractions(f)
      CROSS JOIN (VALUES (''), ('   '), (NULL),
        ('2024-02-29,2024-03-01,2024-03-01,2024-03-02,not-a-date')) holidays(h)`,
      FunctionName.Workday,
      legacyWorkdaySql
    );
  });

  it('matches inclusive-end / exclusive-start diff semantics across leap dates and reversed bounds', async () => {
    await compare(
      `SELECT DATE '2024-02-24' + d AS start_date,
      DATE '2024-02-24' + d + n AS end_date, h AS holiday_text
      FROM generate_series(0, 13) d CROSS JOIN generate_series(-31, 31) n
      CROSS JOIN (VALUES (''), (NULL),
        ('2024-02-29,2024-03-01,2024-03-01,2024-03-02,not-a-date')) holidays(h)`,
      FunctionName.WorkdayDiff,
      legacyWorkdayDiffSql
    );
  });

  it('preserves null operand behavior of both functions', async () => {
    await compare(
      `SELECT NULL::date AS start_date, n AS day_count, '' AS holiday_text
      FROM (VALUES (NULL::integer), (0), (-5), (5)) counts(n)`,
      FunctionName.Workday,
      legacyWorkdaySql
    );
    await compare(
      `SELECT a AS start_date, b AS end_date, '' AS holiday_text
      FROM (VALUES (NULL::date), (DATE '2024-03-01')) starts(a)
      CROSS JOIN (VALUES (NULL::date), (DATE '2024-03-05')) ends(b)`,
      FunctionName.WorkdayDiff,
      legacyWorkdayDiffSql
    );
  });

  it('preserves invalid holiday evaluation for empty and null date ranges', async () => {
    for (const bounds of [
      "DATE '2024-01-01', DATE '2024-01-01'",
      "NULL::date, DATE '2024-01-01'",
      'NULL::date, NULL::date',
      "DATE '2024-01-05', DATE '2024-01-07'",
    ]) {
      const results = [];
      for (const expression of [legacyWorkdayDiffSql, compile(FunctionName.WorkdayDiff)]) {
        try {
          const result = await sql
            .raw(
              `SELECT ${expression} AS value
            FROM (SELECT a AS start_date, b AS end_date, '2024-99-99'::text AS holiday_text
              FROM (VALUES (${bounds})) dates(a,b)) c`
            )
            .execute(db);
          results.push(result.rows);
        } catch (error) {
          results.push(error instanceof Error ? error.message : String(error));
        }
      }
      expect(results[1]).toEqual(results[0]);
    }
  });

  it('matches long-span results without span-proportional enumeration', async () => {
    await compare(
      `SELECT DATE '2000-01-01' AS start_date, n AS day_count, '' AS holiday_text
      FROM (VALUES (-10000), (10000)) counts(n)`,
      FunctionName.Workday,
      legacyWorkdaySql
    );
    await compare(
      `SELECT a AS start_date, b AS end_date,
      '2000-01-03,2000-01-03,2050-01-01' AS holiday_text
      FROM (VALUES (DATE '2000-01-01', DATE '2100-01-01'),
        (DATE '2100-01-01', DATE '2000-01-01')) dates(a,b)`,
      FunctionName.WorkdayDiff,
      legacyWorkdayDiffSql
    );
    expect(compile(FunctionName.WorkdayDiff)).toContain('generate_series(1, b.days % 7)');
  });
});
