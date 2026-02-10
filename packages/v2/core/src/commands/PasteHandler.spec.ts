import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
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
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  ITableRecordRepository,
  RecordMutationResult,
  BatchRecordMutationResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { PasteCommand } from './PasteCommand';
import { PasteHandler } from './PasteHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const noopUndoRedoService = {
  recordEntry: async () => ok(undefined),
} as unknown as UndoRedoService;

const createTableUpdateFlow = (
  tableRepository: FakeTableRepository,
  eventBus: FakeEventBus,
  unitOfWork: FakeUnitOfWork
) => new TableUpdateFlow(tableRepository, new FakeTableSchemaRepository(), eventBus, unitOfWork);

const buildTable = () => {
  const baseId = BaseId.create(`bse${'u'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'v'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Paste Test')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
  const numberFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(numberFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    baseId,
    tableId,
    textFieldId,
    numberFieldId,
  };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((table) => spec.isSatisfiedBy(table));
    if (!match) return err(domainError.notFound({ message: 'Table not found' }));
    return ok(match);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _: IExecutionContext,
    table: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.tables.findIndex((entry) => entry.id().equals(table.id()));
    if (index >= 0) {
      this.tables[index] = table;
    }
    this.updated.push(table);
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _context: IExecutionContext,
    _tables: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _context: IExecutionContext,
    _table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_context: IExecutionContext, _table: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  inserted: TableRecord[] = [];
  updated: RecordUpdateResult[] = [];
  updateCalls = 0;

  async insert(
    _: IExecutionContext,
    __: Table,
    ___: TableRecord
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    ___: ReadonlyArray<TableRecord>
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertManyStream(
    _: IExecutionContext,
    __: Table,
    batches: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    let totalInserted = 0;
    if (Symbol.asyncIterator in batches) {
      for await (const batch of batches as AsyncIterable<ReadonlyArray<TableRecord>>) {
        this.inserted.push(...batch);
        totalInserted += batch.length;
      }
    } else {
      for (const batch of batches as Iterable<ReadonlyArray<TableRecord>>) {
        this.inserted.push(...batch);
        totalInserted += batch.length;
      }
    }

    return ok({ totalInserted });
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId,
    ____: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    batches: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<{ totalUpdated: number }, DomainError>> {
    this.updateCalls += 1;
    let totalUpdated = 0;
    for (const batchResult of batches) {
      if (batchResult.isErr()) {
        return err(batchResult.error);
      }
      for (const update of batchResult.value) {
        this.updated.push(update);
        totalUpdated += 1;
      }
    }
    return ok({ totalUpdated });
  }

  async deleteMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  records: TableRecordReadModel[] = [];

  async find(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>> {
    return ok({ records: this.records, total: this.records.length });
  }

  async findOne(
    _: IExecutionContext,
    __: Table,
    ___: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (this.records.length === 0)
      return err(domainError.notFound({ message: 'Record not found' }));
    return ok(this.records[0]!);
  }

  findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const records = this.records;
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const record of records) {
          yield ok(record);
        }
      },
    };
  }
}

class FakeRecordMutationSpecResolverService {
  needsResolution(_: ICellValueSpec): Result<boolean, DomainError> {
    return ok(false);
  }

  async resolveAndReplace(
    _: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    return ok(spec);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    const transactionContext = { ...context, transaction };
    return work(transactionContext);
  }
}

class FakeForeignTableLoaderService {
  async load() {
    return ok([]);
  }
}

class FakeFieldCreationSideEffectService {
  async execute() {
    return ok({ events: [], tableState: new Map() });
  }
}

describe('PasteHandler', () => {
  describe('event version', () => {
    it('publishes RecordsBatchUpdated with correct oldVersion and newVersion from existing record', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      // Create record with version 5
      const existingVersion = 5;
      const recordId = `rec${'r'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: { [textFieldId.toString()]: 'Old Title' },
          version: existingVersion,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['New Title']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      // Find the RecordsBatchUpdated event
      const batchUpdatedEvent = eventBus.published.find(
        (event) => event instanceof RecordsBatchUpdated
      ) as RecordsBatchUpdated | undefined;

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(1);

      const update = batchUpdatedEvent!.updates[0]!;
      expect(update.recordId).toBe(recordId);
      expect(update.oldVersion).toBe(existingVersion);
      expect(update.newVersion).toBe(existingVersion + 1);
    });

    it('publishes correct versions for multiple records with different versions', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      // Create records with different versions
      const record1 = {
        id: `rec${'1'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Title 1' },
        version: 3,
      };
      const record2 = {
        id: `rec${'2'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Title 2' },
        version: 7,
      };
      const record3 = {
        id: `rec${'3'.repeat(16)}`,
        fields: { [textFieldId.toString()]: 'Title 3' },
        version: 12,
      };

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [record1, record2, record3];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 2],
        ],
        content: [['Updated 1'], ['Updated 2'], ['Updated 3']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      const batchUpdatedEvent = eventBus.published.find(
        (event) => event instanceof RecordsBatchUpdated
      ) as RecordsBatchUpdated | undefined;

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(3);

      // Verify each record has correct version
      const update1 = batchUpdatedEvent!.updates.find((u) => u.recordId === record1.id);
      expect(update1?.oldVersion).toBe(3);
      expect(update1?.newVersion).toBe(4);

      const update2 = batchUpdatedEvent!.updates.find((u) => u.recordId === record2.id);
      expect(update2?.oldVersion).toBe(7);
      expect(update2?.newVersion).toBe(8);

      const update3 = batchUpdatedEvent!.updates.find((u) => u.recordId === record3.id);
      expect(update3?.oldVersion).toBe(12);
      expect(update3?.newVersion).toBe(13);
    });

    it('publishes update change values normalized to target field types', async () => {
      const { table, tableId, textFieldId, numberFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      const existingVersion = 9;
      const recordId = `rec${'z'.repeat(16)}`;

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: recordId,
          fields: {
            [textFieldId.toString()]: 'Old Text',
            [numberFieldId.toString()]: 1,
          },
          version: existingVersion,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const commandResult = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [1, 0],
        ],
        content: [[123, '456']],
      });

      const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
      expect(result.isOk()).toBe(true);

      const batchUpdatedEvent = eventBus.published.find(
        (event) => event instanceof RecordsBatchUpdated
      ) as RecordsBatchUpdated | undefined;

      expect(batchUpdatedEvent).toBeDefined();
      expect(batchUpdatedEvent!.updates).toHaveLength(1);

      const update = batchUpdatedEvent!.updates[0]!;
      const textChange = update.changes.find((change) => change.fieldId === textFieldId.toString());
      const numberChange = update.changes.find(
        (change) => change.fieldId === numberFieldId.toString()
      );

      expect(textChange).toBeDefined();
      expect(typeof textChange!.newValue).toBe('string');
      expect(textChange!.newValue).toBe('123');

      expect(numberChange).toBeDefined();
      expect(typeof numberChange!.newValue).toBe('number');
      expect(numberChange!.newValue).toBe(456);
    });
  });

  describe('additional behavior', () => {
    it('returns zero counts when content is empty', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, new FakeEventBus(), new FakeUnitOfWork()),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        new FakeTableRecordQueryRepository(),
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        new FakeEventBus(),
        noopUndoRedoService,
        new FakeUnitOfWork()
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [],
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        updatedCount: 0,
        createdCount: 0,
        createdRecordIds: [],
      });
    });

    it('skips updates when updateFilter excludes records', async () => {
      const { table, tableId, textFieldId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [
        {
          id: `rec${'x'.repeat(16)}`,
          fields: { [textFieldId.toString()]: 'Old Title' },
          version: 1,
        },
      ];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [0, 0],
        ],
        content: [['New Title']],
        updateFilter: {
          fieldId: textFieldId.toString(),
          operator: 'is',
          value: 'Different',
        },
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().updatedCount).toBe(0);
      expect(result._unsafeUnwrap().createdCount).toBe(0);
      expect(eventBus.published).toHaveLength(0);
    });

    it('expands columns when paste exceeds field count', async () => {
      const { table, tableId } = buildTable();
      const viewId = table.views()[0]!.id();

      const tableRepository = new FakeTableRepository();
      tableRepository.tables.push(table);
      const tableQueryService = new TableQueryService(tableRepository);

      const recordQueryRepository = new FakeTableRecordQueryRepository();
      recordQueryRepository.records = [];

      const eventBus = new FakeEventBus();
      const unitOfWork = new FakeUnitOfWork();

      const handler = new PasteHandler(
        tableQueryService,
        createTableUpdateFlow(tableRepository, eventBus, unitOfWork),
        new FakeFieldCreationSideEffectService() as never,
        new FakeForeignTableLoaderService() as never,
        new FakeTableRecordRepository(),
        recordQueryRepository,
        new FakeRecordMutationSpecResolverService() as unknown as RecordMutationSpecResolverService,
        new RecordWriteSideEffectService(),
        eventBus,
        noopUndoRedoService,
        unitOfWork
      );

      const command = PasteCommand.create({
        tableId: tableId.toString(),
        viewId: viewId.toString(),
        ranges: [
          [0, 0],
          [2, 0],
        ],
        content: [['A', 'B', 'C']],
      });

      const result = await handler.handle(createContext(), command._unsafeUnwrap());
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().createdCount).toBe(1);
      expect(tableRepository.updated).toHaveLength(1);
      expect(tableRepository.updated[0]?.getFields()).toHaveLength(3);
    });
  });
});
