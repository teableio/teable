import { type IRecordSearchAccessPath } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { isServingSearchSnapshot, toRecordSearchAccessPathFromConfig } from './searchVectorStatus';

const coveredFieldIdStrings = (accessPath: IRecordSearchAccessPath | undefined): string[] =>
  accessPath && accessPath.kind !== 'default'
    ? accessPath.coveredFieldIds.map((id) => id.toString())
    : [];

describe('toRecordSearchAccessPathFromConfig', () => {
  it('converts a ready config row into a generated tsvector access path', () => {
    const fieldId = `fld${'a'.repeat(16)}`;

    const accessPath = toRecordSearchAccessPathFromConfig({
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      fieldIds: JSON.stringify([fieldId]),
      searchScope: 'all_fields',
      status: 'ready',
    });

    expect(accessPath).toMatchObject({
      kind: 'generated_tsvector',
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'all_fields',
    });
    expect(coveredFieldIdStrings(accessPath)).toEqual([fieldId]);
  });

  it('converts a ready substring config into a generated text access path', () => {
    const fieldId = `fld${'b'.repeat(16)}`;
    const accessPath = toRecordSearchAccessPathFromConfig({
      generatedColumnName: '__tqops_search_document',
      semantics: 'substring',
      accessPath: 'generated_text',
      provider: 'pg_bigm',
      fieldIds: [fieldId],
      searchScope: 'all_fields',
      status: 'ready',
    });

    expect(accessPath).toMatchObject({
      kind: 'generated_text',
      generatedColumnName: '__tqops_search_document',
      provider: 'pg_bigm',
      searchScope: 'all_fields',
    });
    expect(coveredFieldIdStrings(accessPath)).toEqual([fieldId]);
  });

  it.each(['stale', 'rebuild_pending'])(
    'retains the configured substring contract while %s',
    (status) => {
      const fieldId = `fld${'c'.repeat(16)}`;
      const accessPath = toRecordSearchAccessPathFromConfig({
        generatedColumnName: '__tqops_search_document',
        semantics: 'substring',
        accessPath: 'generated_text',
        provider: 'pg_trgm',
        fieldIds: [fieldId],
        searchScope: 'all_fields',
        status,
      });
      expect(coveredFieldIdStrings(accessPath)).toEqual([fieldId]);
    }
  );

  it('does not create an access path when covered fields are missing or invalid', () => {
    expect(
      toRecordSearchAccessPathFromConfig({
        generatedColumnName: '__tqops_search_vector',
        languageConfig: 'simple',
        fieldIds: JSON.stringify(['not-a-field']),
        searchScope: 'all_fields',
        status: 'ready',
      })
    ).toBeUndefined();
  });

  it('does not convert a pending config into a usable access path', () => {
    expect(
      toRecordSearchAccessPathFromConfig({
        generatedColumnName: '__tqops_search_vector',
        languageConfig: 'simple',
        fieldIds: JSON.stringify([`fld${'a'.repeat(16)}`]),
        searchScope: 'all_fields',
        status: 'rebuild_pending',
      })
    ).toBeUndefined();
  });
});

describe('isServingSearchSnapshot', () => {
  const snapshot = {
    version: 1 as const,
    dbTableName: 'tbl_orders',
    generatedColumnName: '__tqops_search_document',
    indexName: 'idx_tqops_search_document',
    provider: 'pg_bigm' as const,
    searchScope: 'all_fields' as const,
    definitionKey: 'definition',
    indexUsable: true,
    fields: [
      {
        fieldId: `fld${'d'.repeat(16)}`,
        fieldDbName: 'name',
        textProjection: { kind: 'plain' as const },
      },
    ],
  };

  it('serves when the published snapshot is usable and built for this table', () => {
    expect(isServingSearchSnapshot(snapshot, 'tbl_orders')).toBe(true);
  });

  it.each([
    ['unusable snapshot', { ...snapshot, indexUsable: false }, 'tbl_orders'],
    ['snapshot of another physical table', snapshot, 'tbl_other'],
    ['no snapshot', undefined, 'tbl_orders'],
    ['no table name', snapshot, null],
    ['empty coverage', { ...snapshot, fields: [] }, 'tbl_orders'],
  ])('does not serve for %s', (_label, searchIndex, tableName) => {
    expect(isServingSearchSnapshot(searchIndex, tableName)).toBe(false);
  });
});
