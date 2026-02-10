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
import type { RecordId } from '../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  InsertManyStreamOptions,
  InsertManyStreamResult,
  RecordMutationResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { CreateTableCommand } from './CreateTableCommand';
import { CreateTableHandler } from './CreateTableHandler';

const createContext = (): IExecutionContext => {
  const actorIdResult = ActorId.create('system');
  actorIdResult._unsafeUnwrap();
  actorIdResult._unsafeUnwrap();
  return { actorId: actorIdResult._unsafeUnwrap() };
};

class FakeTableRepository implements ITableRepository {
  inserted: Table[] = [];
  updated: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failInsert: DomainError | undefined;
  failUpdate: DomainError | undefined;
  failFind: DomainError | undefined;

  async insert(context: IExecutionContext, table: Table) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(table);
    return ok(table);
  }

  async insertMany(context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    if (this.failFind) return err(this.failFind);
    const match = this.inserted.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    _options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    if (this.failFind) return err(this.failFind);
    return ok(this.inserted.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    if (this.failUpdate) return err(this.failUpdate);
    const index = this.inserted.findIndex((entry) => entry.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    this.inserted[index] = table;
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  inserted: Table[] = [];
  lastContext: IExecutionContext | undefined;
  failInsert: DomainError | undefined;

  async insert(context: IExecutionContext, table: Table) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(table);
    return ok(undefined);
  }

  async insertMany(context: IExecutionContext, tables: ReadonlyArray<Table>) {
    this.lastContext = context;
    if (this.failInsert) return err(this.failInsert);
    this.inserted.push(...tables);
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

class FakeTableRecordRepository implements ITableRecordRepository {
  inserted: TableRecord[] = [];
  lastContext: IExecutionContext | undefined;

  async insert(context: IExecutionContext, _table: Table, record: TableRecord) {
    this.lastContext = context;
    this.inserted.push(record);
    return ok({} as RecordMutationResult);
  }

  async insertMany(context: IExecutionContext, _table: Table, records: ReadonlyArray<TableRecord>) {
    this.lastContext = context;
    this.inserted.push(...records);
    return ok({} as BatchRecordMutationResult);
  }

  async insertManyStream(
    context: IExecutionContext,
    _table: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    options?: InsertManyStreamOptions
  ) {
    this.lastContext = context;
    let totalInserted = 0;
    let batchIndex = 0;
    for await (const batch of batches as AsyncIterable<ReadonlyArray<TableRecord>>) {
      this.inserted.push(...batch);
      totalInserted += batch.length;
      options?.onBatchInserted?.({ batchIndex, insertedCount: batch.length, totalInserted });
      batchIndex += 1;
    }
    const result: InsertManyStreamResult = { totalInserted };
    return ok(result);
  }

  async updateOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId,
    _mutateSpec: ICellValueSpec
  ) {
    return ok({} as RecordMutationResult);
  }

  async updateManyStream(
    _context: IExecutionContext,
    _table: Table,
    _batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
    return ok({ totalUpdated: 0 });
  }

  async deleteMany(
    _context: IExecutionContext,
    _table: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ) {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];
  failPublish: DomainError | undefined;

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

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
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
    commandResult._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
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

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      recordRepository,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(tableRepository.inserted.length).toBe(1);
    expect(schemaRepository.inserted.length).toBe(1);
    expect(eventBus.published.length).toBeGreaterThan(0);
    expect(unitOfWork.transactions.length).toBe(1);
    expect(tableRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
  });

  it('creates records when provided', async () => {
    const nameFieldId = `fld${'r'.repeat(16)}`;
    const commandResult = CreateTableCommand.create({
      baseId: `bse${'d'.repeat(16)}`,
      name: 'Table With Records',
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Title', isPrimary: true }],
      records: [{ fields: { [nameFieldId]: 'Alpha' } }, { fields: { [nameFieldId]: 'Beta' } }],
      views: [{ type: 'grid' }],
    });
    commandResult._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
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

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      recordRepository,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(recordRepository.inserted.length).toBe(2);
    expect(recordRepository.lastContext?.transaction?.kind).toBe('unitOfWorkTransaction');
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
    commandResult._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
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
    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      recordRepository,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

    const table = result._unsafeUnwrap().table;
    const formulaField = table
      .getFields()
      .find((field) => field.type().toString() === 'formula') as FormulaField | undefined;
    expect(formulaField).toBeDefined();
    if (!formulaField) return;

    expect(formulaField.dependencies().map((id) => id.toString())).toEqual([numberFieldId]);
    const typeResult = formulaField.cellValueType();
    typeResult._unsafeUnwrap();
  });

  it('returns errors from repositories and event bus', async () => {
    const commandResult = createCommand('b');
    commandResult._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    tableRepository.failInsert = domainError.unexpected({ message: 'insert failed' });
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
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

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      recordRepository,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toBe('insert failed');

    tableRepository.failInsert = undefined;
    schemaRepository.failInsert = domainError.unexpected({ message: 'schema failed' });
    const schemaResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(schemaResult._unsafeUnwrapErr().message).toBe('schema failed');

    schemaRepository.failInsert = undefined;
    eventBus.failPublish = domainError.unexpected({ message: 'publish failed' });
    const publishResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(publishResult._unsafeUnwrapErr().message).toBe('publish failed');
  });

  it('deduplicates field names when inputs collide', async () => {
    const commandResult = CreateTableCommand.create({
      baseId: `bse${'c'.repeat(16)}`,
      name: 'Invalid Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Title' },
      ],
      views: [{ type: 'grid' }],
    });
    commandResult._unsafeUnwrap();

    const tableRepository = new FakeTableRepository();
    const schemaRepository = new FakeTableSchemaRepository();
    const recordRepository = new FakeTableRecordRepository();
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

    const handler = new CreateTableHandler(
      tableRepository,
      schemaRepository,
      recordRepository,
      fieldCreationSideEffectService,
      foreignTableLoaderService,
      eventBus,
      unitOfWork
    );

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    // CreateTableCommand resolves duplicate names up-front to keep the table valid.
    const table = result._unsafeUnwrap().table;
    expect(table.getFields().map((field) => field.name().toString())).toEqual(['Title', 'Title 2']);
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
      const recordRepository = new FakeTableRecordRepository();
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
      const handler = new CreateTableHandler(
        tableRepository,
        schemaRepository,
        recordRepository,
        fieldCreationSideEffectService,
        foreignTableLoaderService,
        eventBus,
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
        commandResult._unsafeUnwrap();

        const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
        result._unsafeUnwrap();

        const updatedForeign = tableRepository.inserted.find((table) =>
          table.id().equals(foreignTable.id())
        );
        expect(updatedForeign).toBeDefined();
        if (!updatedForeign) continue;

        const linkFields = updatedForeign
          .getFields()
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
      const recordRepository = new FakeTableRecordRepository();
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
      const handler = new CreateTableHandler(
        tableRepository,
        schemaRepository,
        recordRepository,
        fieldCreationSideEffectService,
        foreignTableLoaderService,
        eventBus,
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
      commandResult._unsafeUnwrap();

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());

      const created = result._unsafeUnwrap().table;
      expect(created.id().toString()).toBe(tableId);
      const linkFields = created.getFields().filter((field) => field.type().toString() === 'link');
      expect(linkFields.length).toBeGreaterThan(0);

      const stored = tableRepository.inserted.find((table) => table.id().equals(created.id()));
      expect(stored).toBeDefined();
      if (!stored) return;
      expect(stored.getFields().filter((field) => field.type().toString() === 'link')).toHaveLength(
        2
      );
    });
  });
});
