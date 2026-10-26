import type { INumberFormatting } from '@teable/core';
import { DbFieldType, NumberFormattingType } from '@teable/core';
import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { PgRecordQueryDialect } from './pg-record-query-dialect';

describe('PgRecordQueryDialect#flattenLookupCteValue', () => {
  const dialect = new PgRecordQueryDialect({} as unknown as Knex);

  it('returns null for single-value lookups', () => {
    const result = dialect.flattenLookupCteValue(
      'cte_lookup',
      'fld_single',
      false,
      DbFieldType.Text
    );
    expect(result).toBeNull();
  });

  it('normalizes json-stored lookup payloads with to_jsonb', () => {
    const sql = dialect.flattenLookupCteValue('cte_lookup', 'fld_json', true, DbFieldType.Json);
    expect(sql).toContain('to_jsonb("cte_lookup"."lookup_fld_json")');
    expect(sql).not.toContain('"cte_lookup"."lookup_fld_json"::jsonb');
  });

  it('normalizes scalar lookup payloads with to_jsonb', () => {
    const sql = dialect.flattenLookupCteValue('cte_lookup', 'fld_scalar', true, DbFieldType.Text);
    expect(sql).toContain('to_jsonb("cte_lookup"."lookup_fld_scalar")');
  });

  it('deduplicates only when enabled, after flattening the lookup array', () => {
    const ordinary = dialect.flattenLookupCteValue(
      'cte_lookup',
      'fld_json',
      true,
      DbFieldType.Json
    );
    const unique = dialect.flattenLookupCteValue(
      'cte_lookup',
      'fld_json',
      true,
      DbFieldType.Json,
      true
    );

    expect(ordinary).not.toContain('DISTINCT ON');
    expect(unique).toContain(ordinary);
    expect(unique).toContain('WITH ORDINALITY');
    expect(unique).toContain("COALESCE(value->'id', value)");
    expect(unique).toContain('jsonb_agg(value ORDER BY ordinal)');
  });
});

describe('PgRecordQueryDialect#linkExtractTitles', () => {
  const dialect = new PgRecordQueryDialect({} as unknown as Knex);

  it('extracts single-value link titles via metadata without pg_typeof guards', () => {
    const sql = dialect.linkExtractTitles('"main"."LinkField"', false);
    expect(sql).toBe(
      `(CASE WHEN "main"."LinkField" IS NULL THEN NULL ELSE ("main"."LinkField"::jsonb)->>'title' END)`
    );
    expect(sql).not.toContain('pg_typeof');
  });

  it('extracts multi-value link titles using jsonb_array_elements without pg_typeof', () => {
    const sql = dialect.linkExtractTitles('"cte"."link_value"', true);
    expect(sql).toContain('jsonb_array_elements("cte"."link_value"::jsonb)');
    expect(sql).not.toContain('pg_typeof');
  });
});

describe('PgRecordQueryDialect user snapshots', () => {
  const dialect = new PgRecordQueryDialect({} as unknown as Knex);

  it('builds CreatedBy/LastModifiedBy display JSON without users joins', () => {
    const sql = dialect.buildUserJsonObjectFromSnapshot(
      '"t"."fld_created_by"',
      '"t"."__created_by"'
    );

    expect(sql).toContain('to_jsonb("t"."fld_created_by")');
    expect(sql).toContain('"t"."__created_by"');
    expect(sql).toContain('jsonb_build_object');
    expect(sql).not.toContain('users');
    expect(sql).not.toContain('public.users');
  });

  it('builds formula display text from snapshot with system id fallback', () => {
    const sql = dialect.userTitleFromSnapshot(
      '"t"."fld_last_modified_by"',
      '"t"."__last_modified_by"'
    );

    expect(sql).toContain('to_jsonb("t"."fld_last_modified_by")');
    expect(sql).toContain("->>'title'");
    expect(sql).toContain('"t"."__last_modified_by"');
    expect(sql).not.toContain('users');
    expect(sql).not.toContain('public.users');
  });
});

describe('PgRecordQueryDialect#coerceToNumericForCompare', () => {
  const dialect = new PgRecordQueryDialect({} as unknown as Knex);

  it('keeps trusted numeric literals as direct numeric casts', () => {
    const sql = dialect.coerceToNumericForCompare('39.93');
    expect(sql).toBe('(39.93)::numeric');
  });

  it('guards malformed sanitized text before numeric cast', () => {
    const sql = dialect.coerceToNumericForCompare('"t"."DisplayPrice"');
    expect(sql).toContain("REGEXP_REPLACE(((\"t\".\"DisplayPrice\")::text), '[^0-9.+-]', '', 'g')");
    expect(sql).toContain("~ '^[+-]{0,1}(\\d+(\\.\\d+){0,1}|\\.\\d+)$'");
    expect(sql).toContain('THEN NULLIF(');
    expect(sql).toContain('::numeric');
    expect(sql).toContain('ELSE NULL');
  });
});

describe('PgRecordQueryDialect#formatNumber currency symbol escaping', () => {
  const dialect = new PgRecordQueryDialect({} as unknown as Knex);
  const currency = (symbol: string, precision?: number): INumberFormatting =>
    ({ type: NumberFormattingType.Currency, symbol, precision }) as INumberFormatting;
  // A generated fragment with an odd number of single quotes has a dangling
  // quote — i.e. the symbol broke out of its literal. Balanced quotes prove it did not.
  const quotesBalanced = (sql: string) => (sql.match(/'/g) ?? []).length % 2 === 0;

  it('embeds a plain symbol as a single-quoted literal', () => {
    expect(dialect.formatNumber('"t"."price"', currency('$', 0))).toBe(
      `'$' || ROUND(CAST("t"."price" AS NUMERIC), 0)::TEXT`
    );
  });

  it('escapes single quotes in the symbol so it cannot break out of the literal', () => {
    const sql = dialect.formatNumber('"t"."price"', currency("x'||pg_sleep(3)||'", 0));
    expect(sql).toBe(
      `'x''||pg_sleep(3)||''' || ROUND(CAST("t"."price" AS NUMERIC), 0)::TEXT`
    );
    expect(quotesBalanced(sql)).toBe(true);
  });

  it('escapes the symbol on the no-precision branch too', () => {
    const sql = dialect.formatNumber('"t"."price"', currency("'); DROP TABLE t;--"));
    expect(sql).toBe(`'''); DROP TABLE t;--' || ("t"."price")::TEXT`);
    expect(quotesBalanced(sql)).toBe(true);
  });

  it('propagates the escaping through formatNumberArray', () => {
    const sql = dialect.formatNumberArray('"t"."prices"', currency("a'b", 0));
    expect(sql).toContain(`'a''b'`);
    expect(quotesBalanced(sql)).toBe(true);
  });
});
