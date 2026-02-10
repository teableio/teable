import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { LinkForeignTableReference } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { MemoryTableRepository } from '../../ports/memory/MemoryTableRepository';
import { ForeignTableLoaderService } from './ForeignTableLoaderService';

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

describe('ForeignTableLoaderService', () => {
  it('returns empty results when no references', async () => {
    const repo = new MemoryTableRepository();
    const service = new ForeignTableLoaderService(repo);

    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const result = await service.load(createContext(), { baseId, references: [] });

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('loads referenced tables', async () => {
    const table = buildTable('a', 'b');
    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, table);

    const service = new ForeignTableLoaderService(repo);
    const references: LinkForeignTableReference[] = [{ foreignTableId: table.id() }];

    const result = await service.load(context, {
      baseId: table.baseId(),
      references,
    });

    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]?.id().toString()).toBe(table.id().toString());
  });

  it('returns not found when references are missing', async () => {
    const table = buildTable('c', 'd');
    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, table);

    const missingId = TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap();
    const references: LinkForeignTableReference[] = [{ foreignTableId: missingId }];

    const service = new ForeignTableLoaderService(repo);
    const result = await service.load(context, {
      baseId: table.baseId(),
      references,
    });

    expect(result._unsafeUnwrapErr().message).toBe('Foreign tables not found');
  });
});
