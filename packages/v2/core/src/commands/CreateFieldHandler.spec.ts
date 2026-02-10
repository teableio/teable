import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { FormulaField } from '../domain/table/fields/types/FormulaField';
import type { LinkField } from '../domain/table/fields/types/LinkField';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateFieldCommand } from './CreateFieldCommand';
import { CreateFieldHandler } from './CreateFieldHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  actorIdResult._unsafeUnwrap();
  actorIdResult._unsafeUnwrap();
  return { actorId: actorIdResult._unsafeUnwrap() };
};

class InMemoryTableRepository implements ITableRepository {
  tables: Table[] = [];

  async insert(_context: IExecutionContext, table: Table) {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(_context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    this.tables[index] = table;
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }

  async insertMany(_context: IExecutionContext, _tables: ReadonlyArray<Table>) {
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ) {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table) {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  async publish(_context: IExecutionContext, _event: IDomainEvent) {
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, _events: ReadonlyArray<IDomainEvent>) {
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    return work({ ...context, transaction });
  }
}

const buildTable = (params: {
  baseId: string;
  tableId: string;
  tableName: string;
  primaryFieldId: string;
}) => {
  return Table.builder()
    .withId(TableId.create(params.tableId)._unsafeUnwrap())
    .withBaseId(BaseId.create(params.baseId)._unsafeUnwrap())
    .withName(TableName.create(params.tableName)._unsafeUnwrap())
    .field()
    .singleLineText()
    .withId(FieldId.create(params.primaryFieldId)._unsafeUnwrap())
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done()
    .view()
    .defaultGrid()
    .done()
    .build()
    ._unsafeUnwrap();
};

describe('CreateFieldHandler', () => {
  it('supports all link relationships and self references', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const hostTableId = `tbl${'b'.repeat(16)}`;
    const foreignTableId = `tbl${'c'.repeat(16)}`;
    const hostPrimaryId = `fld${'d'.repeat(16)}`;
    const foreignPrimaryId = `fld${'e'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService
    );

    tableRepository.tables.push(
      buildTable({
        baseId,
        tableId: hostTableId,
        tableName: 'Host',
        primaryFieldId: hostPrimaryId,
      }),
      buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      })
    );

    const relationships = ['oneOne', 'manyMany', 'oneMany', 'manyOne'] as const;
    for (const relationship of relationships) {
      const commandResult = CreateFieldCommand.create({
        baseId,
        tableId: hostTableId,
        field: {
          type: 'link',
          name: `Link ${relationship}`,
          options: {
            relationship,
            foreignTableId,
            lookupFieldId: foreignPrimaryId,
          },
        },
      });
      commandResult._unsafeUnwrap();

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      result._unsafeUnwrap();

      const updatedForeign = tableRepository.tables.find(
        (table) => table.id().toString() === foreignTableId
      );
      expect(updatedForeign).toBeDefined();
      if (!updatedForeign) continue;
      const linkFields = updatedForeign
        .getFields()
        .filter((field) => field.type().toString() === 'link') as LinkField[];
      expect(linkFields.length).toBeGreaterThan(0);
    }

    const selfCommand = CreateFieldCommand.create({
      baseId,
      tableId: hostTableId,
      field: {
        type: 'link',
        name: 'Self',
        options: {
          relationship: 'manyMany',
          foreignTableId: hostTableId,
          lookupFieldId: hostPrimaryId,
        },
      },
    });

    const selfResult = await handler.handle(createContext(), selfCommand._unsafeUnwrap());
    selfResult._unsafeUnwrap();

    const selfTable = tableRepository.tables.find((table) => table.id().toString() === hostTableId);
    expect(selfTable).toBeDefined();
    if (!selfTable) return;
    const selfLinks = selfTable.getFields().filter((field) => field.type().toString() === 'link');
    expect(selfLinks.length).toBeGreaterThan(1);
  });

  it('creates formula field with resolved cellValueType', async () => {
    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const numberFieldId = `fld${'c'.repeat(16)}`;

    const tableRepository = new InMemoryTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectService = new FieldCreationSideEffectService(tableUpdateFlow);
    const foreignTableLoaderService = new ForeignTableLoaderService(tableRepository);
    const handler = new CreateFieldHandler(
      tableUpdateFlow,
      fieldCreationSideEffectService,
      foreignTableLoaderService
    );

    // Create a table with a number field
    const table = Table.builder()
      .withId(TableId.create(tableId)._unsafeUnwrap())
      .withBaseId(BaseId.create(baseId)._unsafeUnwrap())
      .withName(TableName.create('TestTable')._unsafeUnwrap())
      .field()
      .number()
      .withId(FieldId.create(numberFieldId)._unsafeUnwrap())
      .withName(FieldName.create('Amount')._unsafeUnwrap())
      .primary()
      .done()
      .view()
      .defaultGrid()
      .done()
      .build()
      ._unsafeUnwrap();
    tableRepository.tables.push(table);

    // Create a formula field referencing the number field
    const commandResult = CreateFieldCommand.create({
      baseId,
      tableId,
      field: {
        type: 'formula',
        name: 'Total',
        options: { expression: `{${numberFieldId}}` },
      },
    });
    commandResult._unsafeUnwrap();

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    const updatedTable = tableRepository.tables.find((t) => t.id().toString() === tableId);
    expect(updatedTable).toBeDefined();
    if (!updatedTable) return;

    const formulaField = updatedTable
      .getFields()
      .find((field) => field.type().toString() === 'formula') as FormulaField | undefined;
    expect(formulaField).toBeDefined();
    if (!formulaField) return;

    // Verify cellValueType is set
    const cellValueTypeResult = formulaField.cellValueType();
    expect(cellValueTypeResult.isOk()).toBe(true);
    cellValueTypeResult._unsafeUnwrap();
  });
});
