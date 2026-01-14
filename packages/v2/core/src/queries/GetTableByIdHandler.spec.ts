import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { GetTableByIdHandler } from './GetTableByIdHandler';
import { GetTableByIdQuery } from './GetTableByIdQuery';

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

describe('GetTableByIdHandler', () => {
  it('returns tables from repository', async () => {
    const table = buildTable('a', 'a', 'Alpha');

    const repo = new MemoryTableRepository();
    await repo.insert(createContext(), table);

    const queryResult = GetTableByIdQuery.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    const handler = new GetTableByIdHandler(repo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.table.id().equals(table.id())).toBe(true);
  });

  it('maps not found errors', async () => {
    const tableIdResult = TableId.create(`tbl${'b'.repeat(16)}`);
    const baseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const tableId = tableIdResult._unsafeUnwrap();
    const baseId = baseIdResult._unsafeUnwrap();

    const queryResult = GetTableByIdQuery.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
    });

    const handler = new GetTableByIdHandler(new MemoryTableRepository(), new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });

  it('returns repository errors', async () => {
    const repository: ITableRepository = {
      insert: async () => err(domainError.unexpected({ message: 'insert failed' })),
      insertMany: async () => err(domainError.unexpected({ message: 'insert failed' })),
      findOne: async () => err(domainError.unexpected({ message: 'lookup failed' })),
      find: async () => err(domainError.unexpected({ message: 'lookup failed' })),
      updateOne: async () => err(domainError.unexpected({ message: 'update failed' })),
      delete: async () => err(domainError.unexpected({ message: 'delete failed' })),
    };

    const queryResult = GetTableByIdQuery.create({
      baseId: `bse${'c'.repeat(16)}`,
      tableId: `tbl${'d'.repeat(16)}`,
    });

    const handler = new GetTableByIdHandler(repository, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('lookup failed');
  });
});
