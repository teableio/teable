import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { LinkForeignTableReference } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { SetLinkValueSpec } from '../../domain/table/records/specs/values/SetLinkValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
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

  it('loads referenced tables from the explicit reference base', async () => {
    const localTable = buildTable('a', 'c');
    const externalTable = buildTable('d', 'e');
    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, localTable);
    await repo.insert(context, externalTable);

    const service = new ForeignTableLoaderService(repo);
    const references: LinkForeignTableReference[] = [
      { foreignTableId: externalTable.id(), baseId: externalTable.baseId() },
    ];

    const result = await service.load(context, {
      baseId: localTable.baseId(),
      references,
    });

    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(result._unsafeUnwrap()[0]?.id().toString()).toBe(externalTable.id().toString());
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

    expect(result._unsafeUnwrapErr().message).toBe(
      `Foreign tables not found: ${missingId.toString()}`
    );
    expect(result._unsafeUnwrapErr().details).toEqual({
      missingForeignTableIds: [missingId.toString()],
    });
  });

  it('skips missing foreign tables when allowMissing is true', async () => {
    const table = buildTable('n', 'o');
    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, table);

    const missingId = TableId.create(`tbl${'p'.repeat(16)}`)._unsafeUnwrap();
    const references: LinkForeignTableReference[] = [
      { foreignTableId: table.id() },
      { foreignTableId: missingId },
    ];

    const service = new ForeignTableLoaderService(repo);
    const result = await service.load(context, {
      baseId: table.baseId(),
      references,
      allowMissing: true,
    });

    const loaded = result._unsafeUnwrap();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id().toString()).toBe(table.id().toString());
  });

  it('loads link-title fill foreign tables directly from mutate specs', async () => {
    const table = buildTable('f', 'g');
    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, table);

    const service = new ForeignTableLoaderService(repo);
    const fieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetLinkValueSpec(
      fieldId,
      CellValue.fromValidated([{ id: `rec${'i'.repeat(16)}` }]),
      table.id()
    );

    const result = await service.loadForLinkTitleFill(context, [spec]);

    expect(result._unsafeUnwrap().get(table.id().toString())?.id().toString()).toBe(
      table.id().toString()
    );
  });

  it('loads link-title fill foreign tables for single link object mutate specs', async () => {
    const table = buildTable('j', 'k');
    const repo = new MemoryTableRepository();
    const context = createContext();
    await repo.insert(context, table);

    const service = new ForeignTableLoaderService(repo);
    const fieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetLinkValueSpec(
      fieldId,
      CellValue.fromValidated({ id: `rec${'m'.repeat(16)}` }),
      table.id()
    );

    const result = await service.loadForLinkTitleFill(context, [spec]);

    expect(result._unsafeUnwrap().get(table.id().toString())?.id().toString()).toBe(
      table.id().toString()
    );
  });
});
