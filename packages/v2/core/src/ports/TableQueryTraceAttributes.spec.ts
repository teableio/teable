import { describe, expect, it } from 'vitest';

import {
  bucketCount,
  bucketSearchValueLength,
  createSearchTraceAttributes,
  createTableQueryMetricAttributes,
  createTableQueryTraceAttributes,
  TableQueryTraceAttributes,
} from './TableQueryTraceAttributes';

describe('TableQueryTraceAttributes', () => {
  it('bucketizes search values without exposing raw literals', () => {
    const attrs = createSearchTraceAttributes({
      searchValue: 'customer-private-keyword',
      fieldCount: 8,
      allFields: true,
      searchMode: 'full_text',
      accessPath: 'generated_tsvector',
      searchScope: 'all_fields',
      languageConfig: 'simple',
      generatedColumnName: '__tqops_tsv_tbl',
      indexName: 'idx_tqops_tsv_tbl',
    });

    expect(attrs).toMatchObject({
      [TableQueryTraceAttributes.SEARCH_VALUE_LENGTH_BUCKET]: 'medium',
      [TableQueryTraceAttributes.SEARCH_FIELD_COUNT_BUCKET]: 'small',
      [TableQueryTraceAttributes.SEARCH_MODE]: 'full_text',
      [TableQueryTraceAttributes.SEARCH_ACCESS_PATH]: 'generated_tsvector',
    });
    expect(JSON.stringify(attrs)).not.toContain('customer-private-keyword');
  });

  it('keeps table identifiers out of metric attributes unless allowed', () => {
    const baseInput = {
      tableId: 'tblSecret',
      queryKind: 'search',
      querySource: 'api.record_list',
      accessPath: 'default_ilike',
      searchMode: 'ilike',
      hasFilter: true,
    } as const;

    expect(createTableQueryMetricAttributes(baseInput)).not.toHaveProperty(
      TableQueryTraceAttributes.TABLE_ID
    );
    expect(
      createTableQueryMetricAttributes({
        ...baseInput,
        includeTableId: true,
      })
    ).toHaveProperty(TableQueryTraceAttributes.TABLE_ID, 'tblSecret');
  });

  it('describes generated substring access paths without exposing the probe', () => {
    const attrs = createSearchTraceAttributes({
      searchValue: '订单',
      fieldCount: 4,
      allFields: false,
      searchMode: 'substring',
      accessPath: 'generated_text_bigram',
      indexProvider: 'pg_bigm',
      searchScope: 'selected_fields',
    });

    expect(attrs).toMatchObject({
      [TableQueryTraceAttributes.SEARCH_MODE]: 'substring',
      [TableQueryTraceAttributes.SEARCH_ACCESS_PATH]: 'generated_text_bigram',
      [TableQueryTraceAttributes.SEARCH_INDEX_PROVIDER]: 'pg_bigm',
      [TableQueryTraceAttributes.SEARCH_VALUE_LENGTH_BUCKET]: 'short',
    });
    expect(JSON.stringify(attrs)).not.toContain('订单');
  });

  it.each([
    'generated_text_probe_too_short',
    'generated_text_coverage_mismatch',
    'generated_text_unsupported_projection',
    'generated_text_invalid_config',
  ])('preserves the bounded fallback reason %s in metrics', (fallbackReason) => {
    const attrs = createTableQueryMetricAttributes({ fallbackReason });
    expect(attrs[TableQueryTraceAttributes.SEARCH_FALLBACK_REASON]).toBe(fallbackReason);
  });

  it('bounds every dynamic metric label', () => {
    const uncontrolled = 'customer-controlled-value';
    const attrs = createTableQueryMetricAttributes({
      queryKind: uncontrolled,
      querySource: uncontrolled,
      searchMode: uncontrolled,
      accessPath: uncontrolled,
      searchScope: uncontrolled,
      languageConfig: uncontrolled,
      fallbackReason: uncontrolled,
      errorKind: uncontrolled,
    } as unknown as Parameters<typeof createTableQueryMetricAttributes>[0]);

    expect(attrs).toMatchObject({
      [TableQueryTraceAttributes.QUERY_KIND]: 'other',
      [TableQueryTraceAttributes.QUERY_SOURCE]: 'other',
      [TableQueryTraceAttributes.SEARCH_MODE]: 'other',
      [TableQueryTraceAttributes.SEARCH_ACCESS_PATH]: 'other',
      [TableQueryTraceAttributes.SEARCH_SCOPE]: 'other',
      [TableQueryTraceAttributes.SEARCH_LANGUAGE_CONFIG]: 'other',
      [TableQueryTraceAttributes.SEARCH_FALLBACK_REASON]: 'other',
      [TableQueryTraceAttributes.ERROR_KIND]: 'other',
    });
    expect(JSON.stringify(attrs)).not.toContain(uncontrolled);
  });
  it('builds trace attributes with ids and only bucketized counts', () => {
    const attrs = createTableQueryTraceAttributes({
      spaceId: 'spc1',
      baseId: 'base1',
      tableId: 'tbl1',
      viewId: 'viw1',
      queryKind: 'record_list',
      querySource: 'v2.list_records',
      resultCount: 48,
      estimatedRows: 200_000,
      errorKind: 'timeout',
    });

    expect(attrs).toMatchObject({
      [TableQueryTraceAttributes.SPACE_ID]: 'spc1',
      [TableQueryTraceAttributes.TABLE_ID]: 'tbl1',
      [TableQueryTraceAttributes.QUERY_RESULT_COUNT_BUCKET]: 'medium',
      [TableQueryTraceAttributes.QUERY_ESTIMATED_ROWS_BUCKET]: 'huge',
      [TableQueryTraceAttributes.ERROR_KIND]: 'timeout',
    });
  });

  it('uses stable buckets for counts and search lengths', () => {
    expect([
      bucketCount(undefined),
      bucketCount(0),
      bucketCount(1),
      bucketCount(2),
      bucketCount(100),
      bucketCount(101),
      bucketCount(10_001),
    ]).toEqual(['none', 'zero', 'one', 'small', 'medium', 'large', 'huge']);
    expect([
      bucketSearchValueLength(undefined),
      bucketSearchValueLength('abc'),
      bucketSearchValueLength('a'.repeat(64)),
      bucketSearchValueLength('a'.repeat(65)),
    ]).toEqual(['none', 'short', 'medium', 'long']);
  });
});
