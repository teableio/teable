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
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  ITableRecordQueryOptions,
  ITableRecordQueryRepository,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import { GetRecordStatusHandler } from './GetRecordStatusHandler';
import { GetRecordStatusQuery } from './GetRecordStatusQuery';

const context: IExecutionContext = {
  actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap(),
};

const buildTable = () => {
  const tableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();
  const recordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap())
    .withId(tableId)
    .withName(TableName.create('Status')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), tableId, recordId };
};

const createRecordRepository = (options: {
  exists: boolean;
  visibleCount: number;
  recordId?: string;
  records?: ReadonlyArray<TableRecordReadModel>;
}): ITableRecordQueryRepository =>
  ({
    findOne: vi.fn(async () =>
      options.exists
        ? ok({
            id: 'rec',
            fields: {},
            version: 1,
          })
        : err(domainError.notFound({ code: 'record.not_found', message: 'Record not found' }))
    ),
    count: vi.fn(async () => ok(options.visibleCount)),
    find: vi.fn(async (_context, table, spec, queryOptions: ITableRecordQueryOptions = {}) => {
      const records =
        options.records ??
        (options.visibleCount > 0 && options.recordId
          ? [{ id: options.recordId, fields: {}, version: 1 }]
          : []);
      const matching = records.filter((record) => {
        if (!spec) return true;
        const domainRecord = TableRecord.fromRawFieldValues({
          id: record.id,
          tableId: table.id(),
          fields: { ...record.fields },
        })._unsafeUnwrap();
        return spec.isSatisfiedBy(domainRecord);
      });
      const sorted = [...matching].sort((left, right) => {
        for (const order of queryOptions.orderBy ?? []) {
          if (!('fieldId' in order)) continue;
          const fieldId = order.fieldId.toString();
          const comparison = String(left.fields[fieldId] ?? '').localeCompare(
            String(right.fields[fieldId] ?? '')
          );
          if (comparison !== 0) return order.direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
      const offset = queryOptions.pagination?.offset().toNumber() ?? 0;
      const limit = queryOptions.pagination?.limit().toNumber() ?? sorted.length;
      return ok({ records: sorted.slice(offset, offset + limit), total: sorted.length });
    }),
  }) as unknown as ITableRecordQueryRepository;

describe('GetRecordStatusQuery', () => {
  it('defaults fieldKeyType to id and rejects malformed identifiers', () => {
    const fixture = buildTable();
    const query = GetRecordStatusQuery.create({
      tableId: fixture.tableId.toString(),
      recordId: fixture.recordId.toString(),
    })._unsafeUnwrap();

    expect(query.fieldKeyType).toBe('id');
    expect(
      GetRecordStatusQuery.create({ tableId: 'invalid', recordId: 'invalid' })._unsafeUnwrapErr()
        .code
    ).toBe('validation.invalid');
  });
});

describe('GetRecordStatusHandler', () => {
  it('marks a matching record outside the requested sorted page as hidden', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const titleFieldId = fixture.table.primaryFieldId().toString();
    const firstRecordId = RecordId.create(`rec${'f'.repeat(16)}`)._unsafeUnwrap();
    const handler = new GetRecordStatusHandler(
      tableRepository,
      createRecordRepository({
        exists: true,
        visibleCount: 1,
        records: [
          { id: fixture.recordId.toString(), fields: { [titleFieldId]: 'Alpha' }, version: 1 },
          { id: firstRecordId.toString(), fields: { [titleFieldId]: 'Zulu' }, version: 1 },
        ],
      }),
      new NoopLogger()
    );
    const query = GetRecordStatusQuery.create({
      tableId: fixture.tableId.toString(),
      recordId: fixture.recordId.toString(),
      sort: [{ fieldId: titleFieldId, order: 'desc' }],
      groupBy: [titleFieldId],
      limit: 1,
      offset: 0,
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap()).toEqual({
      isDeleted: false,
      isVisible: false,
    });
  });

  it('marks a record omitted from selectedRecordIds as hidden', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const otherRecordId = RecordId.create(`rec${'s'.repeat(16)}`)._unsafeUnwrap();
    const handler = new GetRecordStatusHandler(
      tableRepository,
      createRecordRepository({
        exists: true,
        visibleCount: 1,
        records: [
          { id: fixture.recordId.toString(), fields: {}, version: 1 },
          { id: otherRecordId.toString(), fields: {}, version: 1 },
        ],
      }),
      new NoopLogger()
    );
    const query = GetRecordStatusQuery.create({
      tableId: fixture.tableId.toString(),
      recordId: fixture.recordId.toString(),
      selectedRecordIds: [otherRecordId.toString()],
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap()).toEqual({
      isDeleted: false,
      isVisible: false,
    });
  });

  it('applies the record query plugin row scope when determining visibility', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const allowedRecordId = RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap();
    const handler = new GetRecordStatusHandler(
      tableRepository,
      createRecordRepository({
        exists: true,
        visibleCount: 1,
        records: [
          { id: fixture.recordId.toString(), fields: {}, version: 1 },
          { id: allowedRecordId.toString(), fields: {}, version: 1 },
        ],
      }),
      new NoopLogger()
    );
    const query = GetRecordStatusQuery.create(
      {
        tableId: fixture.tableId.toString(),
        recordId: fixture.recordId.toString(),
      },
      {
        queryScope: { recordSpec: RecordByIdsSpec.create([allowedRecordId]) },
        table: fixture.table,
      }
    )._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap()).toEqual({
      isDeleted: false,
      isVisible: false,
    });
  });

  it('marks a missing record as deleted and hidden', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const handler = new GetRecordStatusHandler(
      tableRepository,
      createRecordRepository({ exists: false, visibleCount: 0 }),
      new NoopLogger()
    );
    const query = GetRecordStatusQuery.create({
      tableId: fixture.tableId.toString(),
      recordId: fixture.recordId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap()).toEqual({
      isDeleted: true,
      isVisible: false,
    });
  });

  it('marks an existing filtered-out record as hidden', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const handler = new GetRecordStatusHandler(
      tableRepository,
      createRecordRepository({ exists: true, visibleCount: 0 }),
      new NoopLogger()
    );
    const query = GetRecordStatusQuery.create({
      tableId: fixture.tableId.toString(),
      recordId: fixture.recordId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap()).toEqual({
      isDeleted: false,
      isVisible: false,
    });
  });

  it('marks an existing visible record as visible', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const handler = new GetRecordStatusHandler(
      tableRepository,
      createRecordRepository({
        exists: true,
        visibleCount: 1,
        recordId: fixture.recordId.toString(),
      }),
      new NoopLogger()
    );
    const query = GetRecordStatusQuery.create({
      tableId: fixture.tableId.toString(),
      recordId: fixture.recordId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap()).toEqual({
      isDeleted: false,
      isVisible: true,
    });
  });
});
