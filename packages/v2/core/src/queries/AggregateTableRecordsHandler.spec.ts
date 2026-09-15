import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  IRecordSearchAccessPath,
  ITableRecordAggregationQueryRepository,
} from '../ports/TableRecordQueryRepository';
import { AggregateTableRecordsHandler } from './AggregateTableRecordsHandler';
import { AggregateTableRecordsQuery } from './AggregateTableRecordsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('usr_current')._unsafeUnwrap(),
};

const buildTable = () => {
  const textFieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
  const numberFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Aggregate Query')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), textFieldId, numberFieldId };
};

describe('AggregateTableRecordsQuery', () => {
  it('parses the aggregate request without exposing repository options', () => {
    const { table, numberFieldId } = buildTable();
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: table.defaultView()._unsafeUnwrap().id().toString(),
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
      groupBy: [{ fieldId: numberFieldId.toString(), order: 'desc' }],
      includeHiddenFields: true,
    })._unsafeUnwrap();

    expect(query.tableId.equals(table.id())).toBe(true);
    expect(query.fields).toEqual([{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }]);
    expect(query.includeHiddenFields).toBe(true);
  });

  it('parses a paginated row-range slice', () => {
    const { table, numberFieldId } = buildTable();
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: table.defaultView()._unsafeUnwrap().id().toString(),
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
      orderBy: [{ fieldId: numberFieldId.toString(), order: 'asc' }],
      skip: 1,
      take: 2,
    })._unsafeUnwrap();

    expect(query.skip).toBe(1);
    expect(query.take).toBe(2);
    expect(query.orderBy).toEqual([{ fieldId: numberFieldId.toString(), order: 'asc' }]);
  });

  it.each([
    undefined,
    {},
    { tableId: 'bad', viewId: 'bad' },
    { tableId: `tbl${'a'.repeat(16)}`, viewId: `viw${'a'.repeat(16)}`, fields: [{}] },
    {
      tableId: `tbl${'a'.repeat(16)}`,
      viewId: `viw${'a'.repeat(16)}`,
      skip: 1,
    },
  ])('rejects invalid input: %j', (input) => {
    expect(AggregateTableRecordsQuery.create(input).isErr()).toBe(true);
  });
});

describe('AggregateTableRecordsHandler', () => {
  it.each([false, true])(
    'forwards trusted search access paths through aggregates (collapsed=%s)',
    async (collapsed) => {
      const { table, textFieldId, numberFieldId } = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(context, table);
      const accessPath: IRecordSearchAccessPath = {
        kind: 'generated_text',
        generatedColumnName: '__tqops_document',
        provider: 'pg_trgm',
        searchScope: 'all_fields',
        coveredFieldIds: [textFieldId, numberFieldId],
      };
      const input = {
        tableId: table.id().toString(),
        viewId: table.defaultView()._unsafeUnwrap().id().toString(),
        search: ['Alpha', '', true],
        fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
        groupBy: [{ fieldId: textFieldId.toString(), order: 'asc' }],
        ...(collapsed ? { collapsedGroupIds: ['not-a-matching-group'] } : {}),
        recordSearchAccessPath: accessPath,
      };
      // Physical column names must come from trusted service options, never the request body.
      expect(
        AggregateTableRecordsQuery.create(input)._unsafeUnwrap().recordSearchAccessPath
      ).toBeUndefined();
      const query = AggregateTableRecordsQuery.create(input, {
        recordSearchAccessPath: accessPath,
      })._unsafeUnwrap();
      const aggregate = vi
        .fn<ITableRecordAggregationQueryRepository['aggregate']>()
        .mockResolvedValue(ok([]));
      const handler = new AggregateTableRecordsHandler(
        tableRepository,
        { aggregate } as unknown as ITableRecordAggregationQueryRepository,
        new NoopLogger()
      );

      expect((await handler.handle(context, query)).isOk()).toBe(true);
      expect(aggregate).toHaveBeenCalledTimes(collapsed ? 2 : 1);
      for (const call of aggregate.mock.calls) {
        expect(call[4]?.searchAccessPath).toBe(accessPath);
        expect(call[4]?.search?.search.value).toBe('Alpha');
      }
    }
  );

  it('loads Table with its View child, builds the record condition, and calls the Record repository', async () => {
    const { table, textFieldId, numberFieldId } = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, table);
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>(
      async (_context, aggregateTable, aggregation, spec, options) => {
        expect(aggregateTable).toBe(table);
        expect(spec).toBeDefined();
        expect(
          aggregation.fields.map(({ fieldId, statisticFunc }) => ({
            fieldId: fieldId.toString(),
            statisticFunc,
          }))
        ).toEqual([{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }]);
        expect(
          aggregation.groupBy.map(({ fieldId, order }) => ({
            fieldId: fieldId.toString(),
            order,
          }))
        ).toEqual([{ fieldId: textFieldId.toString(), order: 'asc' }]);
        expect(options?.search?.search.value).toBe('A');
        expect(options?.search?.visibleFieldIds?.map(String)).toContain(textFieldId.toString());
        return ok([
          {
            fieldId: numberFieldId,
            statisticFunc: 'sum',
            value: 30,
          },
        ]);
      }
    );
    const handler = new AggregateTableRecordsHandler(
      tableRepository,
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: table.defaultView()._unsafeUnwrap().id().toString(),
      filter: {
        fieldId: textFieldId.toString(),
        operator: 'contains',
        value: 'A',
      },
      search: ['A', textFieldId.toString(), true],
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
      groupBy: [{ fieldId: textFieldId.toString(), order: 'asc' }],
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().values[0]).toMatchObject({
      statisticFunc: 'sum',
      value: 30,
    });
    expect(aggregate).toHaveBeenCalledOnce();
  });

  it('forwards skip/take and orderBy to the record repository', async () => {
    const { table, numberFieldId } = buildTable();
    const viewId = table.defaultView()._unsafeUnwrap().id().toString();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, table);
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>(
      async (_context, _table, _aggregation, _spec, options) => {
        expect(options?.pagination?.limit().toNumber()).toBe(2);
        expect(options?.pagination?.offset().toNumber()).toBe(1);
        expect(
          options?.orderBy?.some(
            (item) =>
              'fieldId' in item && item.fieldId.equals(numberFieldId) && item.direction === 'asc'
          )
        ).toBe(true);
        expect(
          options?.orderBy?.some((item) => 'column' in item && item.column === `__row_${viewId}`)
        ).toBe(true);
        expect(
          options?.orderBy?.some((item) => 'column' in item && item.column === '__auto_number')
        ).toBe(true);
        return ok([
          {
            fieldId: numberFieldId,
            statisticFunc: 'sum',
            value: 50,
          },
        ]);
      }
    );
    const handler = new AggregateTableRecordsHandler(
      tableRepository,
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId,
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
      orderBy: [{ fieldId: numberFieldId.toString(), order: 'asc' }],
      skip: 1,
      take: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().values[0]?.value).toBe(50);
    expect(aggregate).toHaveBeenCalledOnce();
  });

  it('omits view row order when ignoreViewQuery is true', async () => {
    const { table, numberFieldId } = buildTable();
    const viewId = table.defaultView()._unsafeUnwrap().id().toString();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, table);
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>(
      async (_context, _table, _aggregation, _spec, options) => {
        expect(
          options?.orderBy?.some((item) => 'column' in item && item.column === `__row_${viewId}`)
        ).toBe(false);
        expect(
          options?.orderBy?.some((item) => 'column' in item && item.column === '__auto_number')
        ).toBe(true);
        return ok([
          {
            fieldId: numberFieldId,
            statisticFunc: 'sum',
            value: 50,
          },
        ]);
      }
    );
    const handler = new AggregateTableRecordsHandler(
      tableRepository,
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId,
      ignoreViewQuery: true,
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
      skip: 1,
      take: 2,
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().values[0]?.value).toBe(50);
    expect(aggregate).toHaveBeenCalledOnce();
  });

  it('does not use view columnMeta statistics when ignoreViewQuery omits fields', async () => {
    const { table, numberFieldId } = buildTable();
    const viewId = table.defaultView()._unsafeUnwrap().id();
    const updatedTable = table
      .updateViewColumnMeta(viewId, [
        { fieldId: numberFieldId, columnMeta: { statisticFunc: 'sum' } },
      ])
      ._unsafeUnwrap().updateResult!.table;
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, updatedTable);
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>(
      async (_context, _table, aggregation) => {
        expect(aggregation.fields).toEqual([]);
        return ok([]);
      }
    );
    const handler = new AggregateTableRecordsHandler(
      tableRepository,
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: updatedTable.id().toString(),
      viewId: viewId.toString(),
      ignoreViewQuery: true,
      skip: 0,
      take: 5,
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().values).toEqual([]);
    expect(aggregate).toHaveBeenCalledOnce();
  });

  it('does not require the ignored view to exist', async () => {
    const { table } = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, table);
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>(
      async (_context, _table, aggregation) => {
        expect(aggregation.fields).toEqual([]);
        return ok([]);
      }
    );
    const handler = new AggregateTableRecordsHandler(
      tableRepository,
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: `viw${'z'.repeat(16)}`,
      ignoreViewQuery: true,
      skip: 0,
      take: 5,
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().values).toEqual([]);
    expect(aggregate).toHaveBeenCalledOnce();
  });

  it('maps a missing Table or child View to view.not_found before querying records', async () => {
    const { table, numberFieldId } = buildTable();
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>();
    const handler = new AggregateTableRecordsHandler(
      new MemoryTableRepository(),
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: table.defaultView()._unsafeUnwrap().id().toString(),
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('propagates the Table Record repository failure', async () => {
    const { table, numberFieldId } = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, table);
    const aggregate = vi.fn<ITableRecordAggregationQueryRepository['aggregate']>(async () =>
      err(domainError.infrastructure({ message: 'database unavailable' }))
    );
    const handler = new AggregateTableRecordsHandler(
      tableRepository,
      { aggregate } as unknown as ITableRecordAggregationQueryRepository,
      new NoopLogger()
    );
    const query = AggregateTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: table.defaultView()._unsafeUnwrap().id().toString(),
      fields: [{ fieldId: numberFieldId.toString(), statisticFunc: 'sum' }],
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr().message).toBe('database unavailable');
  });
});
