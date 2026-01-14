import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { MemoryTableRepository } from '../../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../../ports/TableRepository';
import { TableQueryService } from './TableQueryService';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseSeed: string, tableSeed: string) => {
  const baseId = BaseId.create(`bse${baseSeed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${tableSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(`Table ${tableSeed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('TableQueryService', () => {
  it('returns tables by id', async () => {
    const table = buildTable('a', 'b');
    const repo = new MemoryTableRepository();
    const service = new TableQueryService(repo);
    const context = createContext();

    await repo.insert(context, table);
    const result = await service.getById(context, table.id());

    expect(result._unsafeUnwrap().id().toString()).toBe(table.id().toString());
  });

  it('returns not found when missing', async () => {
    const repo = new MemoryTableRepository();
    const service = new TableQueryService(repo);
    const context = createContext();
    const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();

    const result = await service.getById(context, tableId);

    expect(result._unsafeUnwrapErr().code).toBe('table.not_found');
  });

  it('scopes lookup to the base', async () => {
    const table = buildTable('a', 'c');
    const repo = new MemoryTableRepository();
    const service = new TableQueryService(repo);
    const context = createContext();

    await repo.insert(context, table);
    const otherBaseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.getByIdInBase(context, otherBaseId, table.id());

    expect(result._unsafeUnwrapErr().code).toBe('table.not_found');
  });

  it('checks existence without errors', async () => {
    const table = buildTable('c', 'd');
    const repo = new MemoryTableRepository();
    const service = new TableQueryService(repo);
    const context = createContext();

    await repo.insert(context, table);
    const found = await service.exists(context, table.id());
    const missing = await service.exists(
      context,
      TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap()
    );

    expect(found._unsafeUnwrap()).toBe(true);
    expect(missing._unsafeUnwrap()).toBe(false);
  });

  it('returns unexpected errors from the repository', async () => {
    const repository: ITableRepository = {
      insert: async () => err(domainError.unexpected({ message: 'insert failed' })),
      insertMany: async () => err(domainError.unexpected({ message: 'insert failed' })),
      findOne: async () => err(domainError.unexpected({ message: 'lookup failed' })),
      find: async () => err(domainError.unexpected({ message: 'lookup failed' })),
      updateOne: async () => err(domainError.unexpected({ message: 'update failed' })),
      delete: async () => err(domainError.unexpected({ message: 'delete failed' })),
    };

    const service = new TableQueryService(repository);
    const context = createContext();
    const tableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();

    const result = await service.getById(context, tableId);

    expect(result._unsafeUnwrapErr().message).toBe('lookup failed');
  });
});
