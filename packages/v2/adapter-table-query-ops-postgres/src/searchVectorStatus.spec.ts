import type { IRecordSearchAccessPath } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { toRecordSearchAccessPathFromConfig } from './searchVectorStatus';

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

  it('does not reactivate an older ready path when the latest config is pending', () => {
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
