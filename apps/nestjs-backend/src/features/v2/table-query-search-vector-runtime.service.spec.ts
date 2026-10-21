import { FieldId, Table } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import {
  TableQuerySearchVectorRuntimeService,
  hasSearchValueForSearchVectorRuntime,
  resolveTableQuerySearchVectorRuntimeMode,
  tableQuerySearchAccessPathRuntimeEnv,
  tableQuerySearchVectorRuntimeEnv,
} from './table-query-search-vector-runtime.service';
import {
  createSearchIndexTable,
  withSearchIndex,
} from './table-query-search-vector-runtime.test-fixture';

const fieldId = `fld${'f'.repeat(16)}`;
const makeService = (values: Record<string, unknown>) =>
  new TableQuerySearchVectorRuntimeService({
    get: (key: string) => values[key],
  } as never);

describe('TableQuerySearchVectorRuntimeService', () => {
  it.each([
    [undefined, 'off'],
    [null, 'off'],
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

  it.each([
    [undefined, false],
    [[], false],
    [[''], false],
    [['   '], false],
    [['order 123'], true],
  ] as const)('resolves runtime search usability for %j as %s', (search, expected) => {
    expect(hasSearchValueForSearchVectorRuntime(search)).toBe(expected);
  });

  it.each([
    {},
    { [tableQuerySearchAccessPathRuntimeEnv]: 'off' },
    {
      [tableQuerySearchAccessPathRuntimeEnv]: 'off',
      [tableQuerySearchVectorRuntimeEnv]: 'auto',
    },
  ])('leaves metadata unused when runtime is off: %j', (values) => {
    const table = createSearchIndexTable(`tbl${'t'.repeat(16)}`, fieldId);
    const searchIndex = vi.spyOn(table, 'searchIndex');
    expect(
      makeService(values).resolveForRecordSearch({ table, search: ['order'] })
    ).toBeUndefined();
    expect(searchIndex).not.toHaveBeenCalled();
  });

  it.each([tableQuerySearchAccessPathRuntimeEnv, tableQuerySearchVectorRuntimeEnv])(
    'resolves saved metadata synchronously when %s enables runtime',
    (env) => {
      const table = createSearchIndexTable(`tbl${'t'.repeat(16)}`, fieldId);
      expect(
        makeService({ [env]: 'auto' }).resolveForRecordSearch({ table, search: ['order'] })
      ).toMatchObject({
        kind: 'generated_text',
        generatedColumnName: '__search_document',
        provider: 'pg_trgm',
        coveredFieldIds: [FieldId.create(fieldId)._unsafeUnwrap()],
      });
    }
  );

  it('does not activate saved metadata for an empty search', () => {
    const table = createSearchIndexTable(`tbl${'t'.repeat(16)}`, fieldId);
    expect(
      makeService({ [tableQuerySearchAccessPathRuntimeEnv]: 'auto' }).resolveForRecordSearch({
        table,
        search: ['  '],
      })
    ).toBeUndefined();
  });

  it('retains a configured fallback when the saved index is unusable', () => {
    const table = withSearchIndex(
      createSearchIndexTable(`tbl${'t'.repeat(16)}`, fieldId),
      [fieldId],
      { indexUsable: false }
    );
    expect(
      makeService({ [tableQuerySearchAccessPathRuntimeEnv]: 'auto' }).resolveForRecordSearch({
        table,
        search: ['order'],
      })
    ).toMatchObject({
      kind: 'generated_text',
      indexUsable: false,
    });
  });

  it('keeps legacy search when serving metadata is absent', () => {
    const source = createSearchIndexTable(`tbl${'t'.repeat(16)}`, fieldId);
    const table = Table.rehydrate({
      id: source.id(),
      baseId: source.baseId(),
      name: source.name(),
      fields: source.getFields(),
      views: source.views(),
      primaryFieldId: source.primaryFieldId(),
      dbTableName: source.dbTableName()._unsafeUnwrap(),
    })._unsafeUnwrap();
    expect(
      makeService({ [tableQuerySearchAccessPathRuntimeEnv]: 'auto' }).resolveForRecordSearch({
        table,
        search: ['order'],
      })
    ).toBeUndefined();
  });
});
