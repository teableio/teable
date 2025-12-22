import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import { GetTableByIdHandler } from './GetTableByIdHandler';
import { GetTableByIdQuery } from './GetTableByIdQuery';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  expect(actorIdResult.isOk()).toBe(true);
  if (actorIdResult.isErr()) throw new Error('ActorId required for tests');
  return { actorId: actorIdResult.value };
};

const buildTable = (baseIdSeed: string, tableIdSeed: string, name: string) => {
  const baseIdResult = BaseId.create(`bse${baseIdSeed.repeat(16)}`);
  const tableIdResult = TableId.create(`tbl${tableIdSeed.repeat(16)}`);
  const tableNameResult = TableName.create(name);
  const fieldNameResult = FieldName.create('Title');
  expect(
    [baseIdResult, tableIdResult, tableNameResult, fieldNameResult].every((r) => r.isOk())
  ).toBe(true);
  if (
    baseIdResult.isErr() ||
    tableIdResult.isErr() ||
    tableNameResult.isErr() ||
    fieldNameResult.isErr()
  )
    return undefined;

  const builder = Table.builder()
    .withBaseId(baseIdResult.value)
    .withId(tableIdResult.value)
    .withName(tableNameResult.value);
  builder.field().singleLineText().withName(fieldNameResult.value).done();
  builder.view().defaultGrid().done();
  const buildResult = builder.build();
  expect(buildResult.isOk()).toBe(true);
  if (buildResult.isErr()) return undefined;
  return buildResult.value;
};

describe('GetTableByIdHandler', () => {
  it('returns tables from repository', async () => {
    const table = buildTable('a', 'a', 'Alpha');
    if (!table) return;

    const repo = new MemoryTableRepository();
    await repo.insert(createContext(), table);

    const queryResult = GetTableByIdQuery.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const handler = new GetTableByIdHandler(repo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.table.id().equals(table.id())).toBe(true);
  });

  it('maps not found errors', async () => {
    const tableIdResult = TableId.create(`tbl${'b'.repeat(16)}`);
    const baseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    expect([tableIdResult, baseIdResult].every((r) => r.isOk())).toBe(true);
    if (tableIdResult.isErr() || baseIdResult.isErr()) return;

    const queryResult = GetTableByIdQuery.create({
      baseId: baseIdResult.value.toString(),
      tableId: tableIdResult.value.toString(),
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const handler = new GetTableByIdHandler(new MemoryTableRepository(), new NoopLogger());
    const result = await handler.handle(createContext(), queryResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('Table not found');
    }
  });
});
