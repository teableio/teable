import {
  BaseId,
  DefaultTableMapper,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  getRandomString,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTableRepository } from './PostgresTableRepository';

const createRepository = () =>
  new PostgresTableRepository(
    {} as never,
    {
      toDomain: vi.fn(),
      toDTO: vi.fn(),
    } as never
  );

const createMappedTable = () =>
  Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Projects')._unsafeUnwrap())
    .field()
    .singleLineText();

describe('PostgresTableRepository helpers', () => {
  it('normalizes legacy select options and resolves sort columns', () => {
    const repo = createRepository() as any;

    const legacy = repo.normalizeSelectOptions({ options: ['Todo', 'Done'] });
    expect(legacy.choices).toHaveLength(2);
    expect(legacy.choices[0].id).toMatch(/^cho/);
    expect(legacy.choices[0].name).toBe('Todo');

    const modern = repo.normalizeSelectOptions({
      choices: [
        { id: '', name: 'Ready', color: 'invalid' },
        { id: 'choReadyTrimmed', name: ' Ready ', color: 'blue' },
      ],
      defaultValue: 'ready',
      preventAutoNewOptions: true,
    });
    expect(modern.defaultValue).toBe('ready');
    expect(modern.preventAutoNewOptions).toBe(true);
    expect(modern.choices).toHaveLength(1);
    expect(modern.choices[0].id).toMatch(/^cho/);

    expect(repo.resolveSortColumn({ toString: () => 'name' })).toBe('name');
    expect(repo.resolveSortColumn({ toString: () => 'createdTime' })).toBe('created_time');
    expect(repo.resolveSortColumn({ toString: () => 'anythingElse' })).toBe('id');
  });

  it('parses and normalizes view query fragments', () => {
    const repo = createRepository() as any;

    expect(
      repo.parseViewSort(
        JSON.stringify({ sortObjs: [{ fieldId: 'fld1', order: 'asc' }], manualSort: true })
      )
    ).toEqual({
      sort: [{ fieldId: 'fld1', order: 'asc' }],
      manualSort: true,
    });
    expect(repo.parseViewSort('invalid json')).toEqual({});
    expect(repo.parseViewGroup(JSON.stringify([{ fieldId: 'fld1', order: 'desc' }]))).toEqual([
      { fieldId: 'fld1', order: 'desc' },
    ]);
    expect(repo.parseViewGroup('"oops"')).toBeUndefined();
    expect(repo.parseJsonValue('{"a":1}')).toEqual({ a: 1 });
    expect(repo.parseJsonValue('oops')).toBeUndefined();
  });

  it('maps legacy and v2 filters into normalized v2 nodes', () => {
    const repo = createRepository() as any;

    expect(
      repo.mapV1FilterToV2({
        conjunction: 'and',
        filterSet: [
          { fieldId: 'fld1', operator: '=', isSymbol: true, value: 'x' },
          {
            fieldId: 'fld2',
            operator: 'IS WITH IN',
            value: {
              mode: 'dateRange',
              exactDate: '2024-01-01T00:00:00.000Z',
              exactDateEnd: '2024-01-31T00:00:00.000Z',
              timeZone: 'utc',
            },
          },
        ],
      })
    ).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: 'fld1', operator: 'is', value: 'x' },
        {
          conjunction: 'and',
          items: [
            {
              fieldId: 'fld2',
              operator: 'isOnOrAfter',
              value: { mode: 'exactDate', exactDate: '2024-01-01T00:00:00.000Z', timeZone: 'utc' },
            },
            {
              fieldId: 'fld2',
              operator: 'isOnOrBefore',
              value: { mode: 'exactDate', exactDate: '2024-01-31T00:00:00.000Z', timeZone: 'utc' },
            },
          ],
        },
      ],
    });

    expect(
      repo.mapV1FilterToV2({
        fieldId: 'fld1',
        operator: 'isAnyOf',
        value: [],
      })
    ).toBeNull();
    expect(
      repo.mapV1FilterToV2({
        conjunction: 'or',
        items: [
          { fieldId: 'fld1', operator: 'isEmpty', value: null },
          { not: { fieldId: 'fld2', operator: 'isNot', value: null } },
        ],
      })
    ).toEqual({
      conjunction: 'or',
      items: [
        { fieldId: 'fld1', operator: 'isEmpty', value: null },
        { not: { fieldId: 'fld2', operator: 'isNot', value: null } },
      ],
    });
  });

  it('deserializes field and view DTOs across specialized branches', () => {
    const repo = createRepository() as any;

    expect(
      repo.deserializeFieldDto({
        id: 'fld1',
        name: 'Rating',
        description: null,
        type: 'rating',
        options: JSON.stringify({}),
        meta: null,
        ai_config: null,
        cell_value_type: 'number',
        is_multiple_cell_value: false,
        not_null: null,
        unique: null,
        is_computed: null,
        is_lookup: null,
        is_conditional_lookup: null,
        has_error: null,
        lookup_linked_field_id: null,
        lookup_options: null,
        db_field_name: 'rating_col',
        db_field_type: 'REAL',
      })
    ).toMatchObject({
      type: 'rating',
      options: { icon: 'star', color: 'yellowBright', max: 5 },
      dbFieldName: 'rating_col',
    });

    expect(
      repo.deserializeFieldDto({
        id: 'fld2',
        name: 'Lookup',
        description: null,
        type: 'singleLineText',
        options: JSON.stringify({ label: 'inner' }),
        meta: null,
        ai_config: null,
        cell_value_type: 'string',
        is_multiple_cell_value: false,
        not_null: null,
        unique: null,
        is_computed: null,
        is_lookup: true,
        is_conditional_lookup: true,
        has_error: true,
        lookup_linked_field_id: 'fld_link',
        lookup_options: JSON.stringify({
          foreignTableId: `tbl${'b'.repeat(16)}`,
          lookupFieldId: `fld${'b'.repeat(16)}`,
          condition: { filter: null },
        }),
        db_field_name: null,
        db_field_type: null,
      })
    ).toMatchObject({
      type: 'conditionalLookup',
      isLookup: true,
      isConditionalLookup: true,
      hasError: true,
    });

    expect(
      repo.deserializeFieldDto({
        id: 'fld3',
        name: 'Fallback',
        description: null,
        type: 'mystery',
        options: null,
        meta: null,
        ai_config: '{"foo":1}',
        cell_value_type: null,
        is_multiple_cell_value: null,
        not_null: true,
        unique: true,
        is_computed: true,
        is_lookup: false,
        is_conditional_lookup: false,
        has_error: false,
        lookup_linked_field_id: null,
        lookup_options: null,
        db_field_name: 'mystery_col',
        db_field_type: 'TEXT',
      })
    ).toMatchObject({
      type: 'singleLineText',
      aiConfig: { foo: 1 },
      notNull: true,
      unique: true,
      isComputed: true,
    });

    expect(
      repo
        .deserializeViewDto({
          id: 'viw1',
          name: 'Grid',
          type: 'grid',
          options: '{"density":"compact"}',
          column_meta: '{"fld1":{"hidden":true}}',
          sort: '{"sortObjs":[{"fieldId":"fld1","order":"asc"}],"manualSort":false}',
          filter: '{"fieldId":"fld1","operator":"is","value":"x"}',
          group: '[{"fieldId":"fld2","order":"desc"}]',
        })
        ._unsafeUnwrap()
    ).toMatchObject({
      type: 'grid',
      options: { density: 'compact' },
      query: {
        filter: { fieldId: 'fld1', operator: 'is', value: 'x' },
        sort: [{ fieldId: 'fld1', order: 'asc' }],
        group: [{ fieldId: 'fld2', order: 'desc' }],
        manualSort: false,
      },
    });

    expect(
      repo
        .deserializeViewDto({
          id: 'viw2',
          name: 'Bad',
          type: 'unknown',
          options: null,
          column_meta: null,
          sort: null,
          filter: null,
          group: null,
        })
        .isErr()
    ).toBe(true);
  });

  it('computes version changes and applies db metadata to tables', () => {
    const repo = createRepository() as any;

    expect(
      repo.buildFieldVersionChanges(
        ['fld1', 'fld2', 'fld1'],
        new Map([
          ['fld1', 5],
          ['fld2', 3],
        ])
      )
    ).toEqual([
      { fieldId: 'fld1', oldVersion: 3, newVersion: 4 },
      { fieldId: 'fld2', oldVersion: 2, newVersion: 3 },
      { fieldId: 'fld1', oldVersion: 4, newVersion: 5 },
    ]);
    expect(repo.buildViewVersionChanges(['viw1', 'viw1'], new Map([['viw1', 2]]))).toEqual([
      { viewId: 'viw1', oldVersion: 0, newVersion: 1 },
      { viewId: 'viw1', oldVersion: 1, newVersion: 2 },
    ]);

    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
      .withId(TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Apply Meta')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap().clone(new DefaultTableMapper())._unsafeUnwrap();
    const field = table.getFields()[0]!;

    const okResult = repo.applyDbMeta(table, {
      tableId: table.id().toString(),
      dbTableName: `${table.baseId().toString()}.${table.id().toString()}`,
      fields: [
        {
          field: { id: field.id().toString() },
          dbFieldName: 'name_col',
        },
      ],
    });
    expect(okResult.isOk()).toBe(true);
    expect(
      table
        .dbTableName()
        .andThen((value: any) => value.value())
        ._unsafeUnwrap()
    ).toBe(`${table.baseId().toString()}.${table.id().toString()}`);
    expect(
      field
        .dbFieldName()
        .andThen((value: any) => value.value())
        ._unsafeUnwrap()
    ).toBe('name_col');

    const missingFieldResult = repo.applyDbMeta(table, {
      tableId: table.id().toString(),
      dbTableName: `${table.baseId().toString()}.${table.id().toString()}`,
      fields: [
        {
          field: { id: `fld${'z'.repeat(16)}` },
          dbFieldName: 'missing',
        },
      ],
    });
    expect(missingFieldResult.isErr()).toBe(true);
  });
});
