import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { ListTablesHandler } from './ListTablesHandler';
import { ListTablesQuery } from './ListTablesQuery';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  expect(actorIdResult.isOk()).toBe(true);
  if (actorIdResult.isErr()) throw new Error('ActorId required for tests');
  return { actorId: actorIdResult.value };
};

const buildTable = (baseIdSeed: string, name: string) => {
  const baseIdResult = BaseId.create(`bse${baseIdSeed.repeat(16)}`);
  const tableNameResult = TableName.create(name);
  const fieldNameResult = FieldName.create('Title');
  expect([baseIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())).toBe(true);
  if (baseIdResult.isErr() || tableNameResult.isErr() || fieldNameResult.isErr()) return undefined;

  const builder = Table.builder().withBaseId(baseIdResult.value).withName(tableNameResult.value);
  builder.field().singleLineText().withName(fieldNameResult.value).done();
  builder.view().defaultGrid().done();
  const buildResult = builder.build();
  expect(buildResult.isOk()).toBe(true);
  if (buildResult.isErr()) return undefined;
  return buildResult.value;
};

describe('ListTablesHandler', () => {
  it('lists tables with sorting and pagination', async () => {
    const tableA = buildTable('a', 'Alpha');
    const tableB = buildTable('a', 'Beta');
    if (!tableA || !tableB) return;

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
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const handler = new ListTablesHandler(repo, new NoopLogger());
    const result = await handler.handle(context, queryResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.tables.length).toBe(1);
    expect(result.value.tables[0]?.name().toString()).toBe('Beta');
  });

  it('filters by name query', async () => {
    const tableA = buildTable('b', 'Alpha');
    const tableB = buildTable('b', 'Beta');
    if (!tableA || !tableB) return;

    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, tableA);
    await repo.insert(context, tableB);

    const queryResult = ListTablesQuery.create({
      baseId: tableA.baseId().toString(),
      q: 'Alp',
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const handler = new ListTablesHandler(repo, new NoopLogger());
    const result = await handler.handle(context, queryResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.tables.map((table) => table.name().toString())).toEqual(['Alpha']);
  });

  it('returns repository errors', async () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    expect(baseIdResult.isOk()).toBe(true);
    if (baseIdResult.isErr()) return;

    const queryResult = ListTablesQuery.create({
      baseId: baseIdResult.value.toString(),
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const repo: ITableRepository = {
      insert: async () => err('nope'),
      findOne: async () => err('nope'),
      find: async () => err('repository error'),
      updateOne: async (_context, _table, _mutateSpec) => err('nope'),
      delete: async () => err('nope'),
    };

    const handler = new ListTablesHandler(repo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('repository error');
    }
  });
});
