import { DbFieldType } from '@teable/core';
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

  it('keeps jsonb payloads when field is stored as json', () => {
    const sql = dialect.flattenLookupCteValue('cte_lookup', 'fld_json', true, DbFieldType.Json);
    expect(sql).toContain('"cte_lookup"."lookup_fld_json"::jsonb');
    expect(sql).not.toContain('to_jsonb("cte_lookup"."lookup_fld_json")');
  });

  it('wraps scalar payloads with to_jsonb for non-json fields', () => {
    const sql = dialect.flattenLookupCteValue('cte_lookup', 'fld_scalar', true, DbFieldType.Text);
    expect(sql).toContain('to_jsonb("cte_lookup"."lookup_fld_scalar")');
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
