import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldName } from '../../domain/table/fields/FieldName';
import { RecordId } from '../../domain/table/records/RecordId';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { NoopLogger } from '../../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { MemoryTableRepository } from '../../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import { GetRecordByIdHandler } from '../GetRecordByIdHandler';
import { GetRecordByIdQuery } from '../GetRecordByIdQuery';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseIdSeed: string, tableIdSeed: string, name: string) => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(name)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withId(tableId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createMockRecordQueryRepo = (findOneResult: any): ITableRecordQueryRepository => ({
  find: async () => ok({ records: [], total: 0 }),
  findOne: async () => findOneResult,
  async *findStream() {},
});

describe('GetRecordByIdHandler', () => {
  it('returns record on success', async () => {
    const table = buildTable('a', 'a', 'Alpha');
    const repo = new MemoryTableRepository();
    await repo.insert(createContext(), table);

    const mockRecord = { id: `rec${'a'.repeat(16)}`, fields: {} };
    const recordQueryRepo = createMockRecordQueryRepo(ok(mockRecord));

    const query = GetRecordByIdQuery.create({
      tableId: table.id().toString(),
      recordId: `rec${'a'.repeat(16)}`,
    })._unsafeUnwrap();

    const handler = new GetRecordByIdHandler(repo, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);
    const payload = result._unsafeUnwrap();

    expect(payload.record).toBe(mockRecord);
  });

  it('returns table not found error', async () => {
    const mockRecordQueryRepo = createMockRecordQueryRepo(ok(null));

    const query = GetRecordByIdQuery.create({
      tableId: `tbl${'b'.repeat(16)}`,
      recordId: `rec${'b'.repeat(16)}`,
    })._unsafeUnwrap();

    const handler = new GetRecordByIdHandler(
      new MemoryTableRepository(),
      mockRecordQueryRepo,
      new NoopLogger()
    );
    const result = await handler.handle(createContext(), query);
    const error = result._unsafeUnwrapErr();
    expect(error.message).toBe('Table not found');
  });

  it('returns record not found error', async () => {
    const table = buildTable('c', 'c', 'Charlie');
    const repo = new MemoryTableRepository();
    await repo.insert(createContext(), table);

    const recordQueryRepo = createMockRecordQueryRepo(
      err(domainError.notFound({ message: 'not found' }))
    );

    const query = GetRecordByIdQuery.create({
      tableId: table.id().toString(),
      recordId: `rec${'c'.repeat(16)}`,
    })._unsafeUnwrap();

    const handler = new GetRecordByIdHandler(repo, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);
    const error = result._unsafeUnwrapErr();
    expect(error.message).toBe('Record not found');
  });

  it('propagates repository errors', async () => {
    const repository: ITableRepository = {
      insert: async () => err(domainError.unexpected({ message: 'insert failed' })),
      insertMany: async () => err(domainError.unexpected({ message: 'insert failed' })),
      findOne: async () => err(domainError.unexpected({ message: 'lookup failed' })),
      find: async () => err(domainError.unexpected({ message: 'lookup failed' })),
      updateOne: async () => err(domainError.unexpected({ message: 'update failed' })),
      restore: async () => err(domainError.unexpected({ message: 'restore failed' })),
      delete: async () => err(domainError.unexpected({ message: 'delete failed' })),
    };

    const mockRecordQueryRepo = createMockRecordQueryRepo(ok(null));

    const query = GetRecordByIdQuery.create({
      tableId: `tbl${'d'.repeat(16)}`,
      recordId: `rec${'d'.repeat(16)}`,
    })._unsafeUnwrap();

    const handler = new GetRecordByIdHandler(repository, mockRecordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);
    expect(result._unsafeUnwrapErr().message).toBe('lookup failed');
  });
});
