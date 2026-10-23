import type { AST } from 'node-sql-parser';
import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';

import { classifyStructuredCoverage } from './structured-coverage';

const parser = new Parser();

const classify = (sql: string) =>
  classifyStructuredCoverage(parser.parse(sql, { database: 'postgresql' }).ast as AST | AST[]);

describe('structured query coverage classifier', () => {
  it.each([
    'SELECT "title" FROM "bse"."tbl" LIMIT 10',
    'SELECT "title", "__created_time" FROM "bse"."tbl" WHERE "status" = \'open\' ORDER BY "title" DESC',
    'SELECT "title" FROM "bse"."tbl" WHERE NOT ("status" = $1)',
    'SELECT "title" FROM "bse"."tbl" LIMIT $1 OFFSET $2',
  ])('marks a structurally supported records query as a migration candidate: %s', (sql) => {
    expect(classify(sql)).toMatchObject({ candidate: 'records', gaps: [], unknown: [] });
  });

  it.each([
    'SELECT COUNT(*) AS "count" FROM "bse"."tbl"',
    'SELECT "status", SUM("amount") AS "total" FROM "bse"."tbl" GROUP BY "status"',
    'SELECT "status", COUNT(DISTINCT "owner") AS "owners" FROM "bse"."tbl" GROUP BY "status"',
  ])('marks a structurally supported aggregate as a migration candidate: %s', (sql) => {
    expect(classify(sql)).toMatchObject({ candidate: 'aggregate', gaps: [], unknown: [] });
  });

  it.each([
    ['SELECT COUNT("amount" + 1) FROM "bse"."tbl"', ['aggregate_expression']],
    ['SELECT COUNT(DISTINCT LOWER("title")) FROM "bse"."tbl"', ['aggregate_expression']],
    [
      'SELECT COUNT("amount") FILTER (WHERE "amount" > 0) FROM "bse"."tbl"',
      ['aggregate_expression', 'aggregate_filter'],
    ],
    ['SELECT "status" FROM "bse"."tbl" GROUP BY "status"', ['missing_aggregate']],
  ])('rejects aggregate forms not represented by one field statistic: %s', (sql, gaps) => {
    expect(classify(sql)).toMatchObject({ candidate: 'aggregate', gaps });
  });

  it('returns every structural gap instead of hiding secondary capabilities', () => {
    const result = classify(
      'SELECT ROW_NUMBER() OVER (ORDER BY a."amount") FROM "bse"."a" a JOIN "bse"."b" b ON a."id" = b."id" WHERE a."id" IN (SELECT "id" FROM "bse"."c") ORDER BY a."title" NULLS LAST'
    );

    expect(result.candidate).toBe('records');
    expect(result.features).toEqual(expect.arrayContaining(['join', 'subquery', 'window']));
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        'filter_expression',
        'join',
        'projection_expression',
        'subquery',
        'window',
      ])
    );
  });

  it.each([
    ['SELECT "id" FROM "bse"."tbl" WHERE "id" IN (SELECT "id" FROM "bse"."other")', 'subquery'],
    ['SELECT "id" FROM "bse"."tbl" WHERE "id" > (SELECT MIN("id") FROM "bse"."other")', 'subquery'],
    ['SELECT "id" FROM "bse"."tbl" ORDER BY ROW_NUMBER() OVER (ORDER BY "id")', 'window'],
    ['SELECT 1', 'missing_source'],
    ['SELECT LOWER("title") FROM "bse"."tbl"', 'projection_expression'],
    ['SELECT DISTINCT "status" FROM "bse"."tbl"', 'distinct_projection'],
    ['SELECT "g" FROM generate_series(1, 3) AS "g"', 'source_expression'],
  ])('reports conservative boundary %s', (sql, gap) => {
    expect(classify(sql).gaps).toContain(gap);
  });

  it('separates unknown parser shape from known capability gaps', () => {
    const ast = parser.parse('SELECT "id" FROM "bse"."tbl"', {
      database: 'postgresql',
    }).ast as AST;
    (ast as unknown as Record<string, unknown>).future_clause = { enabled: true };

    expect(classifyStructuredCoverage(ast)).toMatchObject({
      candidate: 'records',
      gaps: [],
      unknown: ['unknown_clause'],
    });
  });

  it('rejects non-select and multi-statement input', () => {
    expect(classify('UPDATE "bse"."tbl" SET "title" = \'x\'')).toMatchObject({
      candidate: null,
      gaps: ['non_select_statement'],
    });
    expect(
      classifyStructuredCoverage(
        parser.parse('SELECT 1 FROM "bse"."a"; SELECT 1 FROM "bse"."b"', {
          database: 'postgresql',
        }).ast as AST | AST[]
      )
    ).toMatchObject({ candidate: null, gaps: ['multiple_statements'] });
  });

  it('fingerprints shape without leaking literals or physical identifiers', () => {
    const first = classify(
      'SELECT "private_name" FROM "bse_private"."tbl_private" WHERE "secret_status" = \'sentinel-one\''
    );
    const sameShape = classify(
      'SELECT "public_name" FROM "bse_other"."tbl_other" WHERE "other_status" = \'sentinel-two\''
    );
    const differentShape = classify(
      'SELECT "public_name" FROM "bse_other"."tbl_other" WHERE "other_status" > 42'
    );
    const differentFunction = classify(
      'SELECT UPPER("public_name") FROM "bse_other"."tbl_other" WHERE "other_status" > 42'
    );
    const sameFunction = classify(
      'SELECT LOWER("public_name") FROM "bse_other"."tbl_other" WHERE "other_status" > 42'
    );

    expect(first.fingerprint).toBe(sameShape.fingerprint);
    expect(first.fingerprint).not.toBe(differentShape.fingerprint);
    expect(differentFunction.fingerprint).not.toBe(sameFunction.fingerprint);
    expect(JSON.stringify(first)).not.toMatch(/private|secret|sentinel/);
  });

  it('treats explicit null ordering as expressible', () => {
    expect(
      classify('SELECT "id" FROM "bse"."tbl" ORDER BY "id" ASC NULLS FIRST, "name" DESC NULLS LAST')
    ).toMatchObject({ gaps: [], version: 2 });
  });
});
