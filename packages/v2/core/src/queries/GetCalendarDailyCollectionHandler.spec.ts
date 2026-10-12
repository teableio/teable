import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableUpdateViewQueryDefaultsSpec } from '../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordCalendarQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import { GetCalendarDailyCollectionHandler } from './GetCalendarDailyCollectionHandler';
import {
  GetCalendarDailyCollectionQuery,
  type IGetCalendarDailyCollectionQueryOptions,
} from './GetCalendarDailyCollectionQuery';
import { buildRecordConditionSpec } from './RecordFilterMapper';

const context: IExecutionContext = {
  actorId: ActorId.create('usr_current')._unsafeUnwrap(),
};

const buildTable = () => {
  const nameId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
  const startId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const endId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'d'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Calendar Query')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(nameId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.field().date().withId(startId).withName(FieldName.create('Start')._unsafeUnwrap()).done();
  builder.field().date().withId(endId).withName(FieldName.create('End')._unsafeUnwrap()).done();
  builder.view().calendar().defaultName().done();
  const table = builder.build()._unsafeUnwrap();
  return { table, nameId, startId, endId, viewId: table.defaultView()._unsafeUnwrap().id() };
};

const buildQuery = (
  fixture: ReturnType<typeof buildTable>,
  overrides: Record<string, unknown> = {},
  options?: IGetCalendarDailyCollectionQueryOptions
) =>
  GetCalendarDailyCollectionQuery.create(
    {
      tableId: fixture.table.id().toString(),
      viewId: fixture.viewId.toString(),
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2025-01-03T00:00:00.000Z',
      startDateFieldId: fixture.startId.toString(),
      endDateFieldId: fixture.endId.toString(),
      ...overrides,
    },
    options
  )._unsafeUnwrap();

const createRecordRepository = (
  records: ReadonlyArray<TableRecordReadModel>
): ITableRecordCalendarQueryRepository => ({
  calendarDailyCollection: async (_context, table, _calendar, _range, spec) => {
    const matching = records.filter(
      (record) =>
        !spec ||
        spec.isSatisfiedBy(
          TableRecord.fromRawFieldValues({
            id: record.id,
            tableId: table.id(),
            fields: record.fields,
          })._unsafeUnwrap()
        )
    );
    return ok(
      matching.length
        ? [
            {
              date: '2025-01-01',
              count: matching.length,
              recordIds: matching.map((record) => RecordId.create(record.id)._unsafeUnwrap()),
            },
          ]
        : []
    );
  },
  find: async (_context, table, spec, options) => {
    const projection = options?.projectionFieldIds?.map(String);
    const matching = records.filter(
      (record) =>
        !spec ||
        spec.isSatisfiedBy(
          TableRecord.fromRawFieldValues({
            id: record.id,
            tableId: table.id(),
            fields: record.fields,
          })._unsafeUnwrap()
        )
    );
    return ok({
      records: matching.map((record) => ({
        ...record,
        fields: Object.fromEntries(
          Object.entries(record.fields).filter(([id]) => !projection || projection.includes(id))
        ),
      })),
      total: matching.length,
    });
  },
  findOne: async () => err(domainError.notFound({ message: 'Not found' })),
  async *findStream() {
    yield* [];
  },
});

describe('GetCalendarDailyCollectionQuery', () => {
  it.each([
    undefined,
    {},
    { tableId: 'bad', viewId: 'bad' },
    {
      tableId: `tbl${'a'.repeat(16)}`,
      viewId: `viw${'a'.repeat(16)}`,
      startDate: '',
      endDate: '',
      startDateFieldId: '',
    },
  ])('rejects invalid input: %j', (input) => {
    expect(GetCalendarDailyCollectionQuery.create(input).isErr()).toBe(true);
  });
});

describe('GetCalendarDailyCollectionHandler', () => {
  it.each([
    { shape: 'no view', includeView: false, ignoreViewQuery: false, expectedCount: 2 },
    { shape: 'ignored view', includeView: true, ignoreViewQuery: true, expectedCount: 2 },
    { shape: 'applied view', includeView: true, ignoreViewQuery: false, expectedCount: 1 },
  ])(
    'applies request filters with $shape',
    async ({ includeView, ignoreViewQuery, expectedCount }) => {
      const fixture = buildTable();
      const table = TableUpdateViewQueryDefaultsSpec.create([
        {
          viewId: fixture.viewId,
          queryDefaults: ViewQueryDefaults.create({
            filter: { fieldId: fixture.nameId.toString(), operator: 'is', value: 'Alpha' },
          })._unsafeUnwrap(),
        },
      ])
        .mutate(fixture.table)
        ._unsafeUnwrap();
      const records = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
        id: `rec${String(index).repeat(16)}`,
        version: 1,
        fields: {
          [fixture.nameId.toString()]: name,
          [fixture.startId.toString()]: '2025-01-01T00:00:00.000Z',
        },
      }));
      const handler = new GetCalendarDailyCollectionHandler(
        new MemoryTableRepository(),
        createRecordRepository(records),
        new NoopLogger()
      );
      const result = (
        await handler.handle(
          context,
          buildQuery(
            fixture,
            {
              viewId: includeView ? fixture.viewId.toString() : undefined,
              ignoreViewQuery,
              filter: { fieldId: fixture.nameId.toString(), operator: 'isNot', value: 'Gamma' },
            },
            { table }
          )
        )
      )._unsafeUnwrap();

      expect(result.countMap).toEqual({ '2025-01-01': expectedCount });
      expect(result.records.map((record) => record.fields[fixture.nameId.toString()])).toEqual(
        expectedCount === 1 ? ['Alpha'] : ['Alpha', 'Beta']
      );
    }
  );

  it('scopes bucket membership and masks returned fields without leaking mask dependencies', async () => {
    const fixture = buildTable();
    const firstId = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();
    const secondId = RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap();
    const deniedId = RecordId.create(`rec${'c'.repeat(16)}`)._unsafeUnwrap();
    const nameId = fixture.nameId.toString();
    const startId = fixture.startId.toString();
    const endId = fixture.endId.toString();
    const records = [firstId, secondId, deniedId].map((id, index) => ({
      id: id.toString(),
      version: 1,
      fields: {
        [nameId]: `Name ${index}`,
        [startId]: '2025-01-01T00:00:00.000Z',
        [endId]: index === 0 ? null : '2025-01-02T00:00:00.000Z',
      },
    }));
    const visibleWhen = buildRecordConditionSpec(fixture.table, {
      fieldId: endId,
      operator: 'isEmpty',
      value: null,
    })._unsafeUnwrap();
    const handler = new GetCalendarDailyCollectionHandler(
      new MemoryTableRepository(),
      createRecordRepository(records),
      new NoopLogger()
    );
    const result = (
      await handler.handle(
        context,
        buildQuery(
          fixture,
          {
            viewId: undefined,
            endDateFieldId: undefined,
          },
          {
            table: fixture.table,
            queryScope: {
              readableFieldIds: new Set([nameId, startId]),
              recordSpec: RecordByIdsSpec.create([firstId, secondId]),
              fieldMasks: [{ fieldId: nameId, visibleWhen }],
            },
          }
        )
      )
    )._unsafeUnwrap();

    expect(result.countMap).toEqual({ '2025-01-01': 2 });
    expect(result.records.map((record) => record.id)).toEqual([
      firstId.toString(),
      secondId.toString(),
    ]);
    expect(result.records.map((record) => record.fields)).toEqual([
      { [nameId]: 'Name 0', [startId]: '2025-01-01T00:00:00.000Z' },
      { [startId]: '2025-01-01T00:00:00.000Z' },
    ]);
  });

  it('rejects an unreadable date field even when includeHiddenFields is requested', async () => {
    const fixture = buildTable();
    const handler = new GetCalendarDailyCollectionHandler(
      new MemoryTableRepository(),
      createRecordRepository([]),
      new NoopLogger()
    );
    const result = await handler.handle(
      context,
      buildQuery(
        fixture,
        {
          includeHiddenFields: true,
        },
        {
          table: fixture.table,
          queryScope: { readableFieldIds: new Set([fixture.nameId.toString()]) },
        }
      )
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'calendar.field_unreadable' });
  });

  it('uses the Table aggregate plan, merges filter/search, and reads deduplicated records in bucket order', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const firstId = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();
    const secondId = RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap();
    const calendarDailyCollection = vi.fn<
      ITableRecordCalendarQueryRepository['calendarDailyCollection']
    >(async (_context, table, calendar, range, spec, options) => {
      expect(table).toBe(fixture.table);
      expect(calendar.startFieldId.equals(fixture.startId)).toBe(true);
      expect(calendar.endFieldId.equals(fixture.endId)).toBe(true);
      expect(range).toEqual({
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2025-01-03T00:00:00.000Z',
      });
      expect(spec).toBeDefined();
      expect(options?.search?.search.value).toBe('Alpha');
      return ok([
        { date: '2025-01-01', count: 1, recordIds: [firstId] },
        { date: '2025-01-02', count: 2, recordIds: [secondId, firstId] },
      ]);
    });
    const find = vi.fn<ITableRecordCalendarQueryRepository['find']>(
      async (_context, _table, _spec, options) => {
        expect(options?.mode).toBe('stored');
        expect(options?.includeTotal).toBe(false);
        expect(options?.recordIdsOrder?.map(String)).toEqual([
          firstId.toString(),
          secondId.toString(),
        ]);
        expect(options?.projectionFieldIds?.map(String)).toEqual([
          fixture.nameId.toString(),
          fixture.startId.toString(),
          fixture.endId.toString(),
        ]);
        return ok({
          records: [
            { id: firstId.toString(), fields: { [fixture.nameId.toString()]: 'A' }, version: 1 },
            { id: secondId.toString(), fields: { [fixture.nameId.toString()]: 'B' }, version: 1 },
          ],
          total: 2,
        });
      }
    );
    const handler = new GetCalendarDailyCollectionHandler(
      tableRepository,
      { calendarDailyCollection, find } as unknown as ITableRecordCalendarQueryRepository,
      new NoopLogger()
    );
    const query = buildQuery(fixture, {
      filter: {
        fieldId: fixture.nameId.toString(),
        operator: 'contains',
        value: 'A',
      },
      search: ['Alpha', fixture.nameId.toString(), true],
    });

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().countMap).toEqual({
      '2025-01-01': 1,
      '2025-01-02': 2,
    });
    expect(result._unsafeUnwrap().records.map((record) => record.id)).toEqual([
      firstId.toString(),
      secondId.toString(),
    ]);
    expect(calendarDailyCollection).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledOnce();
  });

  it('does not turn highlight-only search into a row filter and skips record fetch for empty buckets', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const calendarDailyCollection = vi.fn<
      ITableRecordCalendarQueryRepository['calendarDailyCollection']
    >(async (_context, _table, _calendar, _range, _spec, options) => {
      expect(options?.search).toBeUndefined();
      return ok([]);
    });
    const find = vi.fn<ITableRecordCalendarQueryRepository['find']>();
    const handler = new GetCalendarDailyCollectionHandler(
      tableRepository,
      { calendarDailyCollection, find } as unknown as ITableRecordCalendarQueryRepository,
      new NoopLogger()
    );

    const result = await handler.handle(
      context,
      buildQuery(fixture, { search: ['Alpha', fixture.nameId.toString(), false] })
    );

    expect(result._unsafeUnwrap()).toMatchObject({ countMap: {}, records: [] });
    expect(find).not.toHaveBeenCalled();
  });

  it('maps missing aggregate children and propagates repository failures', async () => {
    const fixture = buildTable();
    const calendarDailyCollection = vi.fn<
      ITableRecordCalendarQueryRepository['calendarDailyCollection']
    >(async () => err(domainError.infrastructure({ message: 'database unavailable' })));
    const missingHandler = new GetCalendarDailyCollectionHandler(
      new MemoryTableRepository(),
      { calendarDailyCollection } as unknown as ITableRecordCalendarQueryRepository,
      new NoopLogger()
    );
    expect(
      (await missingHandler.handle(context, buildQuery(fixture)))._unsafeUnwrapErr()
    ).toMatchObject({ code: 'table.not_found' });
    expect(calendarDailyCollection).not.toHaveBeenCalled();

    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const failingHandler = new GetCalendarDailyCollectionHandler(
      tableRepository,
      { calendarDailyCollection } as unknown as ITableRecordCalendarQueryRepository,
      new NoopLogger()
    );
    expect(
      (await failingHandler.handle(context, buildQuery(fixture)))._unsafeUnwrapErr()
    ).toMatchObject({ message: 'database unavailable' });
  });
});
