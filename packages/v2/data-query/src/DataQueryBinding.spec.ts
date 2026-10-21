import {
  ActorId,
  DefaultTableMapper,
  domainError,
  NoopLogger,
  RecordQueryPluginRunner,
  type IRecordQueryPlugin,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { DataQueryBinding, validateDataQueryFilter } from './DataQueryBinding';
import { DataQueryDefinition } from './DataQueryDefinition';
import { DataQueryService } from './DataQueryService';
import { QueryExecutionService } from './QueryExecutionService';

const tableId = `tbl${'a'.repeat(16)}`;
const textId = `fld${'a'.repeat(16)}`;
const numberId = `fld${'b'.repeat(16)}`;
const otherNumberId = `fld${'c'.repeat(16)}`;
const checkboxId = `fld${'d'.repeat(16)}`;
const dateId = `fld${'e'.repeat(16)}`;
const linkId = `fld${'f'.repeat(16)}`;
const selectId = `fld${'s'.repeat(16)}`;
const mapper = new DefaultTableMapper();
const tableDto = (): ITablePersistenceDTO => ({
  id: tableId,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Original table',
  dbTableName: 'schema.original',
  primaryFieldId: textId,
  fields: [
    { id: textId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
    { id: numberId, name: 'Amount', dbFieldName: 'amount', type: 'number' },
    { id: otherNumberId, name: 'Other', dbFieldName: 'other', type: 'number' },
    { id: checkboxId, name: 'Done', dbFieldName: 'done', type: 'checkbox' },
    { id: dateId, name: 'Date', dbFieldName: 'date', type: 'date' },
    {
      id: selectId,
      name: 'Priority',
      dbFieldName: 'priority',
      type: 'singleSelect',
      options: {
        choices: [
          { id: 'choP1', name: 'P1', color: 'blue' },
          { id: 'choP2', name: 'P2', color: 'yellow' },
          { id: 'choP3', name: 'P3', color: 'green' },
        ],
      },
    },
    {
      id: linkId,
      name: 'Relation',
      dbFieldName: 'relation',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: `tbl${'b'.repeat(16)}`,
        lookupFieldId: textId,
        isOneWay: true,
        fkHostTableName: 'schema.original',
        selfKeyName: '__id',
        foreignKeyName: 'fk_relation',
      },
    },
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});
const records = {
  version: 1,
  kind: 'records',
  tableId,
  select: [{ fieldId: textId, alias: 'title' }],
};

describe('DataQueryBinding', () => {
  it('does not confuse composite or computed semantic values with primitive wire types', () => {
    const dto = tableDto();
    const userId = `fld${'u'.repeat(16)}`;
    const attachmentId = `fld${'v'.repeat(16)}`;
    const formulaId = `fld${'w'.repeat(16)}`;
    const table = mapper
      .toDomain({
        ...dto,
        fields: [
          ...dto.fields,
          {
            id: userId,
            name: 'Users',
            dbFieldName: 'users',
            type: 'user',
            options: { isMultiple: true },
          },
          { id: attachmentId, name: 'Files', dbFieldName: 'files', type: 'attachment' },
          {
            id: formulaId,
            name: 'Formula',
            dbFieldName: 'formula',
            type: 'formula',
            options: { expression: '1' },
            cellValueType: 'number',
            isMultipleCellValue: false,
          },
        ],
      })
      ._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      ...records,
      select: [
        { fieldId: userId, alias: 'users' },
        { fieldId: linkId, alias: 'related' },
        { fieldId: attachmentId, alias: 'files' },
        { fieldId: formulaId, alias: 'computed' },
        { fieldId: numberId, alias: 'amount' },
        { fieldId: checkboxId, alias: 'checked' },
      ],
    })._unsafeUnwrap();
    expect(
      DataQueryBinding.prepare(definition, table)
        ._unsafeUnwrap()
        .outputs.map(({ alias, wireType }) => ({ alias, wireType }))
    ).toEqual([
      { alias: 'users', wireType: 'unknown' },
      { alias: 'related', wireType: 'unknown' },
      { alias: 'files', wireType: 'unknown' },
      { alias: 'computed', wireType: 'unknown' },
      { alias: 'amount', wireType: 'numberOrString' },
      { alias: 'checked', wireType: 'boolean' },
    ]);
  });
  it('describes live outputs and rechecks forbidden/deleted fields without reading records', async () => {
    let current = mapper.toDomain(tableDto())._unsafeUnwrap();
    let forbidden = false;
    const plugin: IRecordQueryPlugin = {
      name: 'live-field-scope',
      supports: () => true,
      scope: () => ok(forbidden ? { readableFieldIds: new Set<string>() } : {}),
    };
    const execute = vi.fn(async () => ok({ rows: [] }));
    const findOne = vi.fn(async () => ok(current));
    const service = new QueryExecutionService(
      new DataQueryService({ findOne }, new RecordQueryPluginRunner([plugin], new NoopLogger()), {
        execute,
      })
    );
    const context = { actorId: ActorId.create('reader')._unsafeUnwrap() };
    const definition = {
      ...records,
      parameters: { id: { type: 'string' } },
      recordId: { type: 'parameter', name: 'id' },
    };
    expect((await service.validate(context, { definition }))._unsafeUnwrap()).toEqual({
      outputs: [
        {
          alias: 'title',
          cellValueType: 'string',
          wireType: 'string' as const,
          isMultipleCellValue: false,
          nullable: true,
        },
      ],
    });
    forbidden = true;
    expect((await service.validate(context, { definition })).isErr()).toBe(true);
    forbidden = false;
    const changed = tableDto();
    changed.fields = changed.fields.filter((field) => field.id !== numberId);
    current = mapper.toDomain(changed)._unsafeUnwrap();
    expect(
      (
        await service.validate(context, {
          definition: { ...records, select: [{ fieldId: numberId, alias: 'amount' }] },
        })
      ).isErr()
    ).toBe(true);
    expect(findOne).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
  });
  it('retains every predicate and field-reference dependency', () => {
    const definition = DataQueryDefinition.create({
      ...records,
      filter: {
        conjunction: 'and',
        items: [
          { fieldId: textId, operator: 'is', value: 'a' },
          {
            not: {
              fieldId: numberId,
              operator: 'isGreater',
              value: { type: 'field', fieldId: otherNumberId },
            },
          },
        ],
      },
    })._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(
      definition,
      mapper.toDomain(tableDto())._unsafeUnwrap()
    )._unsafeUnwrap();
    expect(binding.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: textId, usages: ['projection', 'filter'] }),
        expect.objectContaining({ fieldId: numberId, usages: ['filter'] }),
        expect.objectContaining({ fieldId: otherNumberId, usages: ['reference'] }),
      ])
    );
    const removed = tableDto();
    removed.fields = removed.fields.filter((field) => field.id !== otherNumberId);
    expect(
      DataQueryBinding.prepare(definition, mapper.toDomain(removed)._unsafeUnwrap()).isErr()
    ).toBe(true);
  });

  it('rejects invalid field operators, types and incomplete UI null filters instead of dropping them', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    for (const filter of [
      { fieldId: textId, operator: 'isGreater', value: 'a' },
      { fieldId: numberId, operator: 'is', value: 'SECRET' },
      { fieldId: textId, operator: 'is', value: null },
      { fieldId: numberId, operator: 'is', value: { type: 'field', fieldId: textId } },
      {
        fieldId: numberId,
        operator: 'is',
        value: { type: 'field', fieldId: otherNumberId, tableId: `tbl${'z'.repeat(16)}` },
      },
    ]) {
      const definition = DataQueryDefinition.create({ ...records, filter })._unsafeUnwrap();
      const binding = DataQueryBinding.prepare(definition, table);
      expect(binding.isErr()).toBe(true);
      expect(JSON.stringify(binding._unsafeUnwrapErr())).not.toContain('SECRET');
    }
    const checkbox = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: checkboxId, operator: 'is', value: null },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(checkbox, table).isOk()).toBe(true);
    expect(checkbox.bind({})._unsafeUnwrap().filter).toMatchObject({ value: null });
  });

  it('locates an unsupported filter operator on the offending field instead of collapsing it', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    const unsupported = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: selectId, operator: 'isGreaterEqual', value: 'P2' },
    })._unsafeUnwrap();
    const error = DataQueryBinding.prepare(unsupported, table)._unsafeUnwrapErr();
    expect(error).toMatchObject({
      code: 'data_query.filter_operator_unsupported',
      tags: ['validation'],
      details: {
        fieldId: selectId,
        fieldType: 'singleSelect',
        operator: 'isGreaterEqual',
        supportedOperators: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
      },
    });
    expect(error.message).toContain(selectId);
    expect(error.message).toContain('singleSelect');
    expect(error.message).toContain('isGreaterEqual');
    expect(error.message).toContain('isAnyOf');

    const supported = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: selectId, operator: 'isAnyOf', value: ['P2', 'P3'] },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(supported, table).isOk()).toBe(true);
  });

  it('honors core checkbox null folding before locating a later unsupported leaf', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      ...records,
      filter: {
        conjunction: 'and',
        items: [
          { fieldId: checkboxId, operator: 'isNot', value: null },
          { fieldId: selectId, operator: 'isGreaterEqual', value: 'P2' },
        ],
      },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, table)._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.filter_operator_unsupported',
      details: { fieldId: selectId, operator: 'isGreaterEqual' },
    });

    const checkboxOnly = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: checkboxId, operator: 'isNot', value: null },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(checkboxOnly, table).isOk()).toBe(true);
  });

  it('honors core stale user-operator adaptation before locating a later unsupported leaf', () => {
    const userId = `fld${'u'.repeat(16)}`;
    const dto = tableDto();
    dto.fields = [
      ...dto.fields,
      {
        id: userId,
        name: 'Owner',
        dbFieldName: 'owner',
        type: 'user',
        options: { isMultiple: false },
      },
    ];
    const table = mapper.toDomain(dto)._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      ...records,
      filter: {
        conjunction: 'and',
        items: [
          { fieldId: userId, operator: 'isExactly', value: ['usrReader'] },
          { fieldId: selectId, operator: 'isGreaterEqual', value: 'P2' },
        ],
      },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, table)._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.filter_operator_unsupported',
      details: { fieldId: selectId, operator: 'isGreaterEqual' },
    });

    const adaptedOnly = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: userId, operator: 'isExactly', value: ['usrReader'] },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(adaptedOnly, table).isOk()).toBe(true);
  });

  it('withholds located operator details from a caller denied the table', async () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    let denied = true;
    const plugin: IRecordQueryPlugin = {
      name: 'table-guard',
      supports: () => true,
      guard: () =>
        denied
          ? err(domainError.forbidden({ code: 'data_query.forbidden', message: 'Denied' }))
          : ok(undefined),
    };
    const execute = vi.fn(async () => ok({ rows: [] }));
    const service = new DataQueryService(
      { findOne: async () => ok(table) },
      new RecordQueryPluginRunner([plugin], new NoopLogger()),
      { execute }
    );
    const context = { actorId: ActorId.create('reader')._unsafeUnwrap() };
    const definition = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: selectId, operator: 'isGreaterEqual', value: 'P2' },
    })._unsafeUnwrap();

    const forbidden = await service.execute(context, definition);
    expect(forbidden._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.forbidden',
      tags: ['forbidden'],
    });
    expect(JSON.stringify(forbidden._unsafeUnwrapErr())).not.toContain('singleSelect');
    expect(JSON.stringify(forbidden._unsafeUnwrapErr())).not.toContain('supportedOperators');
    expect(execute).not.toHaveBeenCalled();

    denied = false;
    expect((await service.execute(context, definition))._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.filter_operator_unsupported',
      details: { fieldId: selectId, fieldType: 'singleSelect', operator: 'isGreaterEqual' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps located field and value errors distinct from operator and residual incompatibility', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    expect(
      validateDataQueryFilter(table, {
        fieldId: `fld${'z'.repeat(16)}`,
        operator: 'is',
        value: 'x',
      })._unsafeUnwrapErr()
    ).toMatchObject({
      code: 'data_query.field_missing',
      message: 'A required filter field is missing',
    });
    expect(
      validateDataQueryFilter(table, {
        fieldId: numberId,
        operator: 'is',
        value: 'not-a-number',
      })._unsafeUnwrapErr()
    ).toMatchObject({
      code: 'data_query.filter_value_type',
      message: 'Filter literal has an incompatible value type',
    });
    // A cross-table field reference is a residual incompatibility: its operator is valid,
    // so it cannot be attributed to one field/operator pair.
    expect(
      validateDataQueryFilter(table, {
        fieldId: numberId,
        operator: 'is',
        value: { type: 'field', fieldId: otherNumberId, tableId: `tbl${'z'.repeat(16)}` },
      })._unsafeUnwrapErr()
    ).toMatchObject({ code: 'data_query.filter_incompatible' });
  });

  it('resolves lookup operators through the inner field', () => {
    const lookupId = `fld${'l'.repeat(16)}`;
    const dto = tableDto();
    dto.fields = [
      ...dto.fields,
      {
        id: lookupId,
        name: 'Lookup priority',
        type: 'singleSelect',
        dbFieldName: 'lookup_priority',
        isLookup: true,
        isMultipleCellValue: false,
        options: {
          choices: [
            { id: 'choP1', name: 'P1', color: 'blue' },
            { id: 'choP2', name: 'P2', color: 'yellow' },
          ],
        },
        lookupOptions: {
          linkFieldId: linkId,
          foreignTableId: `tbl${'b'.repeat(16)}`,
          lookupFieldId: selectId,
        },
      },
    ];
    const table = mapper.toDomain(dto)._unsafeUnwrap();
    const unsupported = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: lookupId, operator: 'isGreaterEqual', value: 'P2' },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(unsupported, table)._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.filter_operator_unsupported',
      details: {
        fieldId: lookupId,
        fieldType: 'lookup',
        operator: 'isGreaterEqual',
        supportedOperators: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
      },
    });
    const supported = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: lookupId, operator: 'is', value: 'P2' },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(supported, table).isOk()).toBe(true);
  });

  it('revalidates runtime values even when representative parameter values pass', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    const definition = DataQueryDefinition.create({
      ...records,
      parameters: { amount: { type: 'number', nullable: true } },
      filter: { fieldId: numberId, operator: 'is', value: { type: 'parameter', name: 'amount' } },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, table).isOk()).toBe(true);
    const runtime = definition.bind({ amount: null })._unsafeUnwrap();
    expect(validateDataQueryFilter(table, runtime.filter).isErr()).toBe(true);
    expect(
      validateDataQueryFilter(table, {
        fieldId: numberId,
        operator: 'is',
        value: 'not-a-number',
      }).isErr()
    ).toBe(true);
    const wrongParameter = DataQueryDefinition.create({
      ...records,
      parameters: { amount: { type: 'string' } },
      filter: { fieldId: numberId, operator: 'is', value: { type: 'parameter', name: 'amount' } },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(wrongParameter, table).isErr()).toBe(true);
  });

  it('rejects date range negation instead of silently dropping its predicate', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    const range = {
      mode: 'dateRange' as const,
      exactDate: '2026-01-01T00:00:00.000Z',
      exactDateEnd: '2026-01-03T00:00:00.000Z',
      timeZone: 'UTC',
    };
    const definition = DataQueryDefinition.create({
      ...records,
      filter: { fieldId: dateId, operator: 'isNot', value: range },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, table).isErr()).toBe(true);
    const parameterized = DataQueryDefinition.create({
      ...records,
      parameters: { date: { type: 'date' } },
      filter: { fieldId: dateId, operator: 'isNot', value: { type: 'parameter', name: 'date' } },
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(parameterized, table).isOk()).toBe(true);
    expect(
      validateDataQueryFilter(
        table,
        parameterized.bind({ date: range })._unsafeUnwrap().filter
      ).isErr()
    ).toBe(true);
  });

  it('rejects missing and mismatched lookup and rollup relationships', () => {
    const lookupId = `fld${'g'.repeat(16)}`;
    const rollupId = `fld${'h'.repeat(16)}`;
    const dto = tableDto();
    dto.fields = dto.fields.map((field) =>
      field.type === 'link'
        ? { ...field, options: { ...field.options, relationship: 'manyMany' } }
        : field
    );
    const config = {
      linkFieldId: linkId,
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: textId,
    };
    dto.fields = [
      ...dto.fields,
      {
        id: lookupId,
        name: 'Lookup',
        type: 'singleLineText',
        dbFieldName: 'lookup',
        isLookup: true,
        lookupOptions: config,
        isMultipleCellValue: true,
      },
      {
        id: rollupId,
        name: 'Rollup',
        type: 'rollup',
        dbFieldName: 'rollup',
        options: { expression: 'sum({values})' },
        config,
        cellValueType: 'number',
        isMultipleCellValue: false,
      },
    ];
    const changed: ITablePersistenceDTO = {
      ...dto,
      fields: dto.fields.map((field) =>
        field.type === 'link'
          ? { ...field, options: { ...field.options, foreignTableId: `tbl${'c'.repeat(16)}` } }
          : field
      ),
    };
    for (const fieldId of [lookupId, rollupId]) {
      const definition = DataQueryDefinition.create({
        ...records,
        select: [{ fieldId, alias: 'value' }],
      })._unsafeUnwrap();
      expect(
        DataQueryBinding.prepare(definition, mapper.toDomain(dto)._unsafeUnwrap()).isOk()
      ).toBe(true);
      expect(
        DataQueryBinding.prepare(
          definition,
          mapper.toDomain(changed)._unsafeUnwrap()
        )._unsafeUnwrapErr()
      ).toMatchObject({ code: 'data_query.field_semantics', tags: ['validation'] });
      const missing = { ...dto, fields: dto.fields.filter((field) => field.id !== linkId) };
      expect(
        DataQueryBinding.prepare(
          definition,
          mapper.toDomain(missing)._unsafeUnwrap()
        )._unsafeUnwrapErr()
      ).toMatchObject({ code: 'data_query.field_semantics', tags: ['validation'] });
    }
  });

  it('rejects unresolved computed fields and protects dependency/output contracts', () => {
    const dto = tableDto();
    dto.fields = [
      ...dto.fields,
      {
        id: `fld${'g'.repeat(16)}`,
        name: 'Broken',
        type: 'formula',
        options: { expression: '1' },
        cellValueType: 'number',
        isMultipleCellValue: false,
        hasError: true,
      },
    ];
    const definition = DataQueryDefinition.create({
      ...records,
      select: [{ fieldId: `fld${'g'.repeat(16)}`, alias: 'broken' }],
    })._unsafeUnwrap();
    expect(DataQueryBinding.prepare(definition, mapper.toDomain(dto)._unsafeUnwrap()).isErr()).toBe(
      true
    );
    const binding = DataQueryBinding.prepare(
      DataQueryDefinition.create(records)._unsafeUnwrap(),
      mapper.toDomain(tableDto())._unsafeUnwrap()
    )._unsafeUnwrap();
    Reflect.set(binding.outputs[0], 'alias', 'overridden');
    Reflect.set(binding.dependencies[0], 'fieldId', otherNumberId);
    Reflect.set(binding.dependencies[0].usages, '0', 'filter');
    expect(binding.outputs[0].alias).toBe('title');
    expect(binding.dependencies[0]).toMatchObject({ fieldId: textId, usages: ['projection'] });
  });

  it('uses domain aggregation compatibility and precise date/numeric/group output shapes', () => {
    const table = mapper.toDomain(tableDto())._unsafeUnwrap();
    const base = { version: 1, kind: 'aggregate', tableId };
    for (const aggregate of [
      { fieldId: textId, statisticFunc: 'sum', alias: 'bad' },
      { fieldId: numberId, statisticFunc: 'earliestDate', alias: 'bad' },
      { fieldId: checkboxId, statisticFunc: 'average', alias: 'bad' },
    ])
      expect(
        DataQueryBinding.prepare(
          DataQueryDefinition.create({ ...base, aggregates: [aggregate] })._unsafeUnwrap(),
          table
        ).isErr()
      ).toBe(true);
    const definition = DataQueryDefinition.create({
      ...base,
      aggregates: [
        { fieldId: numberId, statisticFunc: 'sum', alias: 'total' },
        { fieldId: numberId, statisticFunc: 'max', alias: 'maximum' },
        { fieldId: dateId, statisticFunc: 'earliestDate', alias: 'firstDate' },
        { fieldId: textId, statisticFunc: 'count', alias: 'count' },
      ],
      groupBy: [{ fieldId: textId, alias: 'category' }],
    })._unsafeUnwrap();
    const binding = DataQueryBinding.prepare(definition, table)._unsafeUnwrap();
    expect(binding.outputs).toEqual([
      {
        alias: 'category',
        cellValueType: 'string',
        wireType: 'string' as const,
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'total',
        cellValueType: 'number',
        wireType: 'numberOrString' as const,
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'maximum',
        cellValueType: 'number',
        wireType: 'numberOrString' as const,
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'firstDate',
        cellValueType: 'dateTime',
        wireType: 'string' as const,
        isMultipleCellValue: false,
        nullable: true,
      },
      {
        alias: 'count',
        cellValueType: 'number',
        wireType: 'numberOrString' as const,
        isMultipleCellValue: false,
        nullable: false,
      },
    ]);
  });
});
