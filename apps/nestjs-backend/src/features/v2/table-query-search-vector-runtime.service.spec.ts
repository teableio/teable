import { describe, expect, it, vi } from 'vitest';

import {
  TableQuerySearchVectorRuntimeService,
  hasSearchValueForSearchVectorRuntime,
  resolveTableQuerySearchVectorRuntimeMode,
  toRecordSearchAccessPathFromConfig,
} from './table-query-search-vector-runtime.service';

describe('TableQuerySearchVectorRuntimeService', () => {
  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['off', 'off'],
    ['false', 'off'],
    ['auto', 'auto'],
    ['true', 'auto'],
    ['enabled', 'auto'],
    [true, 'auto'],
  ] as const)('resolves runtime mode %s as %s', (input, expected) => {
    expect(resolveTableQuerySearchVectorRuntimeMode(input)).toBe(expected);
  });

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
    expect(accessPath?.coveredFieldIds.map((id) => id.toString())).toEqual([fieldId]);
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

  it.each([
    [undefined, false],
    [[], false],
    [[''], false],
    [['   '], false],
    [['order 123'], true],
  ] as const)('resolves runtime search usability for %j as %s', (search, expected) => {
    expect(hasSearchValueForSearchVectorRuntime(search)).toBe(expected);
  });

  it('does not read meta config when the global runtime gate is off', async () => {
    const service = new TableQuerySearchVectorRuntimeService({
      get: vi.fn().mockReturnValue('off'),
    } as never);
    const container = {
      isRegistered: vi.fn(),
    };

    await expect(
      service.resolveForRecordSearch({
        container: container as never,
        tableId: `tbl${'a'.repeat(16)}`,
        search: ['order 123'],
      })
    ).resolves.toBeUndefined();
    expect(container.isRegistered).not.toHaveBeenCalled();
  });
});
