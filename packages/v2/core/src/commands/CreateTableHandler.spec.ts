import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldCreationSideEffectFlow } from '../application/services/FieldCreationSideEffectFlow';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { FormulaField } from '../domain/table/fields/types/FormulaField';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { ILogger } from '../ports/Logger';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateTableCommand } from './CreateTableCommand';
import { CreateTableHandler } from './CreateTableHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  expect(actorIdResult.isOk()).toBe(true);
  if (actorIdResult.isErr()) throw new Error('ActorId required for tests');
  return { actorId: actorIdResult.value };
};

class FakeTableRepository implements ITableRepository {
  inserted: Table[] = [];
  updated: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failInsert: string | undefined;
  failUpdate: string | undefined;
  failFind: string | undefined;

  async insert(context: IExecutionContext, table: Table) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(table);
    return ok(table);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, string>> {
    if (this.failFind) return err(this.failFind);
    const match = this.inserted.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err('Not found');
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>> {
    if (this.failFind) return err(this.failFind);
    return ok(this.inserted.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, string>> {
    if (this.failUpdate) return err(this.failUpdate);
    const index = this.inserted.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) return err('Not found');
    this.inserted[index] = table;
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failInsert: string | undefined;

  async insert(context: IExecutionContext, table: Table) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(table);
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
  published: IDomainEvent[] = [];
  failPublish: string | undefined;

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    if (this.failPublish) return err(this.failPublish);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    if (this.failPublish) return err(this.failPublish);
    return ok(undefined);
  }
}

class FakeLogger implements ILogger {
  readonly messages: string[] = [];

  debug(message: string): void {
    this.messages.push(message);
  }

  info(message: string): void {
    this.messages.push(message);
  }

  warn(message: string): void {
    this.messages.push(message);
  }

  error(message: string): void {
    this.messages.push(message);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, string>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    this.transactions.push(transactionContext);
    return work(transactionContext);
  }
}

const createCommand = (baseIdSeed: string) => {
  return CreateTableCommand.create({
    baseId: `bse${baseIdSeed.repeat(16)}`,
    name: 'Command Table',
    fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
    views: [{ type: 'grid' }],
  });
};

describe('CreateTableHandler', () => {
  it('builds tables and publishes events', async () => {
    const commandResult = createCommand('a');
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectFlow = new FieldCreationSideEffectFlow(
      tableRepository,
      tableUpdateFlow
    );

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectFlow,
      eventBus,
      logger,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(tableRepository.inserted.length).toBe(1);
    expect(schemaRepository.inserted.length).toBe(1);
    expect(eventBus.published.length).toBeGreaterThan(0);
    expect(unitOfWork.transactions.length).toBe(1);
    expect(tableRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
  });

  it('resolves formula dependencies and types', async () => {
    const numberFieldId = 'fld1111111111111111';
    const formulaFieldId = 'fld2222222222222222';
    const commandResult = CreateTableCommand.create({
      baseId: `bse${'f'.repeat(16)}`,
      name: 'Formula Table',
      fields: [
        { type: 'number', id: numberFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'Total',
          options: { expression: `{${numberFieldId}}` },
        },
      ],
      views: [{ type: 'grid' }],
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectFlow = new FieldCreationSideEffectFlow(
      tableRepository,
      tableUpdateFlow
    );
    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectFlow,
      eventBus,
      logger,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const table = result.value.table;
    const formulaField = table.fields().find((field) => field.type().toString() === 'formula') as
      | FormulaField
      | undefined;
    expect(formulaField).toBeDefined();
    if (!formulaField) return;

    expect(formulaField.dependencies().map((id) => id.toString())).toEqual([numberFieldId]);
    const typeResult = formulaField.cellValueType();
    expect(typeResult.isOk()).toBe(true);
  });

  it('returns errors from repositories and event bus', async () => {
    const commandResult = createCommand('b');
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const tableRepository = new FakeTableRepository();
    tableRepository.failInsert = 'insert failed';
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectFlow = new FieldCreationSideEffectFlow(
      tableRepository,
      tableUpdateFlow
    );

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectFlow,
      eventBus,
      logger,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('insert failed');
    }

    tableRepository.failInsert = undefined;
    schemaRepository.failInsert = 'schema failed';
    const schemaResult = await handler.handle(createContext(), commandResult.value);
    expect(schemaResult.isErr()).toBe(true);
    if (schemaResult.isErr()) {
      expect(schemaResult.error).toBe('schema failed');
    }

    schemaRepository.failInsert = undefined;
    eventBus.failPublish = 'publish failed';
    const publishResult = await handler.handle(createContext(), commandResult.value);
    expect(publishResult.isErr()).toBe(true);
    if (publishResult.isErr()) {
      expect(publishResult.error).toBe('publish failed');
    }
  });

  it('fails when the command produces an invalid table', async () => {
    const commandResult = CreateTableCommand.create({
      baseId: `bse${'c'.repeat(16)}`,
      name: 'Invalid Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Title' },
      ],
      views: [{ type: 'grid' }],
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();
    const tableUpdateFlow = new TableUpdateFlow(
      tableRepository,
      schemaRepository,
      eventBus,
      unitOfWork
    );
    const fieldCreationSideEffectFlow = new FieldCreationSideEffectFlow(
      tableRepository,
      tableUpdateFlow
    );

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      fieldCreationSideEffectFlow,
      eventBus,
      logger,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult.value);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toContain('Field names must be unique');
    }
  });

  describe('link fields', () => {
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

    it('creates symmetric fields for all relationships', async () => {
      const baseId = `bse${'c'.repeat(16)}`;
      const foreignTableId = `tbl${'d'.repeat(16)}`;
      const foreignPrimaryId = `fld${'e'.repeat(16)}`;

      const foreignTable = buildTable({
        baseId,
        tableId: foreignTableId,
        tableName: 'Foreign',
        primaryFieldId: foreignPrimaryId,
      });

      const tableRepository = new FakeTableRepository();
      tableRepository.inserted.push(foreignTable);
      const schemaRepository = new FakeTableSchemaRepository();
      const eventBus = new FakeEventBus();
      const logger = new FakeLogger();
      const unitOfWork = new FakeUnitOfWork();
      const tableUpdateFlow = new TableUpdateFlow(
        tableRepository,
        schemaRepository,
        eventBus,
        unitOfWork
      );
      const fieldCreationSideEffectFlow = new FieldCreationSideEffectFlow(
        tableRepository,
        tableUpdateFlow
      );
      const handler = new CreateTableHandler(
        tableRepository,
        schemaRepository,
        fieldCreationSideEffectFlow,
        eventBus,
        logger,
        unitOfWork
      );

      const relationships = ['oneOne', 'manyMany', 'oneMany', 'manyOne'] as const;
      for (const relationship of relationships) {
        const commandResult = CreateTableCommand.create({
          baseId,
          name: `Link ${relationship}`,
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              name: `Link ${relationship}`,
              options: {
                relationship,
                foreignTableId,
                lookupFieldId: foreignPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
        });
        expect(commandResult.isOk()).toBe(true);
        if (commandResult.isErr()) continue;

        const result = await handler.handle(createContext(), commandResult.value);
        expect(result.isOk()).toBe(true);
        if (result.isErr()) continue;

        const updatedForeign = tableRepository.inserted.find((table) =>
          table.id().equals(foreignTable.id())
        );
        expect(updatedForeign).toBeDefined();
        if (!updatedForeign) continue;

        const linkFields = updatedForeign
          .fields()
          .filter((field) => field.type().toString() === 'link');
        expect(linkFields.length).toBeGreaterThan(0);
      }
    });

    it('supports self-referencing links when tableId is provided', async () => {
      const baseId = `bse${'f'.repeat(16)}`;
      const tableId = `tbl${'g'.repeat(16)}`;
      const lookupFieldId = `fld${'h'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      const schemaRepository = new FakeTableSchemaRepository();
      const eventBus = new FakeEventBus();
      const logger = new FakeLogger();
      const unitOfWork = new FakeUnitOfWork();
      const tableUpdateFlow = new TableUpdateFlow(
        tableRepository,
        schemaRepository,
        eventBus,
        unitOfWork
      );
      const fieldCreationSideEffectFlow = new FieldCreationSideEffectFlow(
        tableRepository,
        tableUpdateFlow
      );
      const handler = new CreateTableHandler(
        tableRepository,
        schemaRepository,
        fieldCreationSideEffectFlow,
        eventBus,
        logger,
        unitOfWork
      );

      const commandResult = CreateTableCommand.create({
        baseId,
        tableId,
        name: 'Self Link',
        fields: [
          { type: 'singleLineText', name: 'Name', id: lookupFieldId, isPrimary: true },
          {
            type: 'link',
            name: 'Self',
            options: {
              relationship: 'manyMany',
              foreignTableId: tableId,
              lookupFieldId,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      expect(commandResult.isOk()).toBe(true);
      if (commandResult.isErr()) return;

      const result = await handler.handle(createContext(), commandResult.value);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const created = result.value.table;
      expect(created.id().toString()).toBe(tableId);
      const linkFields = created.fields().filter((field) => field.type().toString() === 'link');
      expect(linkFields.length).toBeGreaterThan(0);

      const stored = tableRepository.inserted.find((table) => table.id().equals(created.id()));
      expect(stored).toBeDefined();
      if (!stored) return;
      expect(stored.fields().filter((field) => field.type().toString() === 'link')).toHaveLength(2);
    });
  });
});
