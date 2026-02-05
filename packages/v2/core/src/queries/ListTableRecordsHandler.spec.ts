import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRepository } from '../ports/TableRepository';
import { ListTableRecordsHandler } from './ListTableRecordsHandler';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(createBaseId('a'))
    .withName(TableName.create('Records')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([selectOption('Open')])
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('ListTableRecordsHandler', () => {
  it('returns records without a filter', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const captured: { spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec;
        const records: TableRecordReadModel[] = [
          { id: 'rec1', fields: { Title: 'Hello' }, version: 1 },
        ];
        return ok({ records, total: 1 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.records.length).toBe(1);
    expect(payload.total).toBe(1);
    expect(captured.spec).toBeUndefined();
  });

  it('passes filter specs to the query repository', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();

    const captured: { spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      filter: {
        fieldId: titleField.id().toString(),
        operator: 'contains',
        value: 'Hello',
      },
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeDefined();
  });

  it('maps missing tables to not found', async () => {
    const tableRepo: ITableRepository = {
      insert: async (_context, _table) => err(domainError.notFound({ message: 'Not found' })),
      insertMany: async (_context, _tables) => err(domainError.notFound({ message: 'Not found' })),
      findOne: async (_context, _spec) => err(domainError.notFound({ message: 'Not found' })),
      find: async (_context, _spec, _options) =>
        err(domainError.notFound({ message: 'Not found' })),
      updateOne: async (_context, _table, _spec) =>
        err(domainError.notFound({ message: 'Not found' })),
      delete: async (_context, _table) => err(domainError.notFound({ message: 'Not found' })),
    };

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => ok({ records: [], total: 0 }),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: createTableId('b').toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepo, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });

  it('returns filter build errors', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => ok({ records: [], total: 0 }),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      filter: {
        fieldId: 'fldmissing123456789',
        operator: 'is',
        value: 'x',
      },
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toContain('Filter field not found');
  });

  it('propagates query repository errors', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => err(domainError.unexpected({ message: 'query failed' })),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('query failed');
  });
});
