import type { AST } from 'node-sql-parser';
import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';
import {
  buildBaseSqlQueryObservationShape,
  type BaseSqlParsedQuery,
} from './sql-query-observation';

const parser = new Parser();
const target = {
  tableId: 'tblNeutral',
  baseId: 'bseNeutral',
  spaceId: 'spcNeutral',
  dbTableName: 'bseNeutral.tblNeutral',
  fields: [],
};
const executionShape = { durationMs: 4_000, timedOut: false } as const;

const parseSql = (sql: string): BaseSqlParsedQuery => {
  const parsed = parser.parse(sql, { database: 'postgresql' });
  return {
    ast: parsed.ast as AST | AST[],
    tableNames: parser.tableList(sql, { database: 'postgresql' }),
  };
};

describe('base SQL query observation shape', () => {
  it.each([
    ['"other_status"', 'unknown'],
    ['COALESCE("other_status", \'fallback\')', 'unknown'],
    ["'ready'", 'equality'],
    ['$1', 'equality'],
  ])('requires a row-independent equality operand: %s', (operand, operatorFamily) => {
    const result = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT * FROM "bseNeutral"."tblNeutral" WHERE "status" = ${operand} ORDER BY "__created_time"`
      ),
      target: {
        ...target,
        fields: [{ id: 'fldNeutralStatus', dbFieldName: 'status', type: 'singleLineText' }],
      },
      executionShape,
    })._unsafeUnwrap();
    expect(result.shape.snapshot().whereShape?.fields).toEqual([
      { fieldId: 'fldNeutralStatus', fieldType: 'singleLineText', operatorFamily },
    ]);
    expect(result.shape.snapshot().orderShape?.fields).toEqual([
      { systemColumn: '__created_time', direction: 'asc', source: 'sort' },
    ]);
    expect(result.diagnostic.parameterCount).toBe(operand === '$1' ? 1 : 0);
  });

  it('keeps distinct quoted aliases attached to the correct physical column', () => {
    const result = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT "__created_time" AS "Stamp", "__version" AS "stamp" FROM "bseNeutral"."tblNeutral" ORDER BY "Stamp"`
      ),
      target,
      executionShape,
    })._unsafeUnwrap();
    expect(result.shape.snapshot().orderShape?.fields).toEqual([
      { systemColumn: '__created_time', direction: 'asc', source: 'sort' },
    ]);
  });
  it('preserves predicate structure and resolves ordinary fields with default ascending order', () => {
    const result = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT "status" FROM "bseNeutral"."tblNeutral" WHERE "status" IS NOT NULL AND "status" <> '' ORDER BY "status"`
      ),
      target: {
        ...target,
        fields: [{ id: 'fldNeutralStatus', dbFieldName: 'status', type: 'singleLineText' }],
      },
      executionShape,
    })._unsafeUnwrap();

    expect(result.shape.snapshot()).toMatchObject({
      whereShape: {
        conditionCount: 2,
        andDepth: 1,
        orDepth: 0,
        fields: [
          { fieldId: 'fldNeutralStatus', fieldType: 'singleLineText', operatorFamily: 'unknown' },
        ],
      },
      orderShape: {
        fields: [{ fieldId: 'fldNeutralStatus', direction: 'asc', source: 'sort' }],
      },
    });
  });

  it.each([
    'SELECT DISTINCT "__created_time" FROM "bseNeutral"."tblNeutral" ORDER BY "__created_time" ASC',
    'SELECT "__created_time", count(*) FROM "bseNeutral"."tblNeutral" GROUP BY "__created_time" ORDER BY "__created_time" ASC',
    'SELECT count(*) OVER () FROM "bseNeutral"."tblNeutral" ORDER BY "__created_time" ASC',
  ])('keeps complex SQL visible without inventing ordinary sort-index evidence: %s', (query) => {
    const result = buildBaseSqlQueryObservationShape({
      parsed: parseSql(query),
      target,
      executionShape,
    })._unsafeUnwrap();
    expect(result.shape.snapshot().orderShape).toBeUndefined();
    expect(result.diagnostic.statementKind).toBe('select_unsupported_statement');
  });
  it('fingerprints structure while normalizing string, numeric, boolean, and null literals', () => {
    const first = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT * FROM "bseNeutral"."tblNeutral" WHERE "score" > 1 AND "enabled" = true AND "deleted" IS NULL AND "status" = 'first' ORDER BY "__created_time" ASC LIMIT 10`
      ),
      target,
      executionShape,
    })._unsafeUnwrap();
    const second = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT * FROM "bseNeutral"."tblNeutral" WHERE "score" > 999 AND "enabled" = false AND "deleted" IS NULL AND "status" = 'second' ORDER BY "__created_time" ASC LIMIT 5000`
      ),
      target,
      executionShape,
    })._unsafeUnwrap();

    expect(first.diagnostic.fingerprint).toBe(second.diagnostic.fingerprint);
    expect(first.diagnostic.normalizedSql).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain('first');
    expect(JSON.stringify(second)).not.toContain('second');
  });

  it('does not infer a physical system column from an expression alias', () => {
    const result = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT "status" AS "__created_time" FROM "bseNeutral"."tblNeutral" ORDER BY "__created_time" ASC`
      ),
      target,
      executionShape,
    })._unsafeUnwrap();

    expect(result.shape.snapshot().orderShape).toBeUndefined();
    expect(result.diagnostic.statementKind).toBe('select_unsupported_order');
  });

  it('rejects null-ordering and accepts a qualified source table without an alias', () => {
    const nulls = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT "__id" FROM "bseNeutral"."tblNeutral" ORDER BY "__created_time" ASC NULLS FIRST`
      ),
      target,
      executionShape,
    })._unsafeUnwrap();
    const qualified = buildBaseSqlQueryObservationShape({
      parsed: parseSql(
        `SELECT "__id" FROM "bseNeutral"."tblNeutral" ORDER BY "tblNeutral"."__created_time" ASC`
      ),
      target,
      executionShape,
    })._unsafeUnwrap();

    expect(nulls.diagnostic.statementKind).toBe('select_unsupported_order');
    expect(qualified.shape.snapshot().orderShape?.fields).toEqual([
      { systemColumn: '__created_time', direction: 'asc', source: 'sort' },
    ]);
  });
});
