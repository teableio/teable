import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { ListTablesHandler } from './ListTablesHandler';
import { ListTablesQuery } from './ListTablesQuery';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseIdSeed: string, name: string) => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create(name)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('ListTablesHandler', () => {
  it('lists tables with sorting and pagination', async () => {
    const tableA = buildTable('a', 'Alpha');
    const tableB = buildTable('a', 'Beta');

    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, tableA);
    await repo.insert(context, tableB);

    const queryResult = ListTablesQuery.create({
      baseId: tableA.baseId().toString(),
      sortBy: 'name',
      sortDirection: 'desc',
      limit: 1,
      offset: 0,
    });
    const handler = new ListTablesHandler(repo);
    const result = await handler.handle(context, queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.tables.length).toBe(1);
    expect(payload.tables[0]?.name().toString()).toBe('Beta');
  });

  it('filters by name query', async () => {
    const tableA = buildTable('b', 'Alpha');
    const tableB = buildTable('b', 'Beta');

    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, tableA);
    await repo.insert(context, tableB);

    const queryResult = ListTablesQuery.create({
      baseId: tableA.baseId().toString(),
      q: 'Alp',
    });
    const handler = new ListTablesHandler(repo);
    const result = await handler.handle(context, queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.tables.map((table) => table.name().toString())).toEqual(['Alpha']);
  });

  it('returns repository errors', async () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const baseId = baseIdResult._unsafeUnwrap();

    const queryResult = ListTablesQuery.create({
      baseId: baseId.toString(),
    });

    const repo: ITableRepository = {
      insert: async () => err(domainError.unexpected({ message: 'nope' })),
      insertMany: async () => err(domainError.unexpected({ message: 'nope' })),
      findOne: async () => err(domainError.unexpected({ message: 'nope' })),
      find: async () => err(domainError.unexpected({ message: 'repository error' })),
      updateOne: async (_context, _table, _mutateSpec) =>
        err(domainError.unexpected({ message: 'nope' })),
      delete: async () => err(domainError.unexpected({ message: 'nope' })),
    };

    const handler = new ListTablesHandler(repo);
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('repository error');
  });
});
