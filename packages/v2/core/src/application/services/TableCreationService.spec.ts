import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { LinkForeignTableReference } from '../../domain/table/fields/visitors/LinkForeignTableReferenceVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableRepository } from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import { TableCreationService } from './TableCreationService';

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

class FakeTableRepository implements ITableRepository {
  inserted: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.inserted.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.inserted.push(...tables);
    return ok([...tables]);
  }

  async findOne() {
    return err(domainError.notFound({ message: 'not found' }));
  }

  async find() {
    return err(domainError.notFound({ message: 'not found' }));
  }

  async updateOne() {
    return ok(undefined);
  }

  async delete() {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.inserted.push(table);
    return ok(undefined);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.inserted.push(...tables);
    return ok(undefined);
  }

  async update() {
    return ok(undefined);
  }

  async delete() {
    return ok(undefined);
  }
}

class FakeFieldCreationSideEffectService {
  calls: Array<{ table: Table; foreignTables: ReadonlyArray<Table> }> = [];

  async execute(
    _context: IExecutionContext,
    input: {
      table: Table;
      foreignTables: ReadonlyArray<Table>;
      tableState: ReadonlyMap<string, Table>;
      fields: ReadonlyArray<unknown>;
    }
  ) {
    this.calls.push({ table: input.table, foreignTables: input.foreignTables });
    return ok({ events: [] as IDomainEvent[], tableState: new Map(input.tableState) });
  }
}

describe('TableCreationService', () => {
  it('returns empty results when no tables', async () => {
    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const sideEffectService = new FakeFieldCreationSideEffectService();
    const service = new TableCreationService(
      tableRepository,
      schemaRepository,
      sideEffectService as never
    );

    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const externalTable = buildTable('a', 'b');

    const result = await service.execute(createContext(), {
      baseId,
      tables: [],
      externalTables: [externalTable],
      referencesByTable: [],
    });

    const payload = result._unsafeUnwrap();
    expect(payload.persistedTables).toHaveLength(0);
    expect(payload.tableState.get(externalTable.id().toString())).toBeDefined();
    expect(tableRepository.inserted).toHaveLength(0);
    expect(schemaRepository.inserted).toHaveLength(0);
    expect(sideEffectService.calls).toHaveLength(0);
  });

  it('sorts table inserts by foreign dependencies', async () => {
    const tableA = buildTable('c', 'a');
    const tableB = buildTable('c', 'b');
    const referencesByTable: ReadonlyArray<ReadonlyArray<LinkForeignTableReference>> = [
      [{ foreignTableId: tableA.id() }],
      [],
    ];

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const sideEffectService = new FakeFieldCreationSideEffectService();
    const service = new TableCreationService(
      tableRepository,
      schemaRepository,
      sideEffectService as never
    );

    const result = await service.execute(createContext(), {
      baseId: tableA.baseId(),
      tables: [tableB, tableA],
      externalTables: [],
      referencesByTable,
    });

    const payload = result._unsafeUnwrap();
    expect(tableRepository.inserted[0]?.id().equals(tableA.id())).toBe(true);
    expect(tableRepository.inserted[1]?.id().equals(tableB.id())).toBe(true);
    expect(payload.persistedTables[0]?.id().equals(tableB.id())).toBe(true);
    expect(payload.persistedTables[1]?.id().equals(tableA.id())).toBe(true);
    expect(sideEffectService.calls).toHaveLength(2);
  });
});
