import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { RecordId } from '../domain/table/records/RecordId';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordCalendarQueryRepository } from '../ports/TableRecordQueryRepository';
import { GetCalendarDailyCollectionHandler } from './GetCalendarDailyCollectionHandler';
import { GetCalendarDailyCollectionQuery } from './GetCalendarDailyCollectionQuery';

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
  overrides: Record<string, unknown> = {}
) =>
  GetCalendarDailyCollectionQuery.create({
    tableId: fixture.table.id().toString(),
    viewId: fixture.viewId.toString(),
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2025-01-03T00:00:00.000Z',
    startDateFieldId: fixture.startId.toString(),
    endDateFieldId: fixture.endId.toString(),
    ...overrides,
  })._unsafeUnwrap();

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
    ).toMatchObject({ code: 'view.not_found' });
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
