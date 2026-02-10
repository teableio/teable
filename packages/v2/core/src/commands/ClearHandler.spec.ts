import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableQueryService } from '../application/services/TableQueryService';
import type { UndoRedoService } from '../application/services/UndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
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
  ITableRecordQueryRepository,
  ITableRecordQueryStreamOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type {
  BatchRecordMutationResult,
  RecordMutationResult,
  UpdateManyStreamResult,
  ITableRecordRepository,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ClearCommand } from './ClearCommand';
import { ClearHandler } from './ClearHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const noopUndoRedoService = {
  recordEntry: async () => ok(undefined),
} as unknown as UndoRedoService;

const buildTable = () => {
  const baseId = BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const primaryFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const formulaFieldId = FieldId.create(`fld${'q'.repeat(16)}`)._unsafeUnwrap();
  const expression = FormulaExpression.create(`{${primaryFieldId.toString()}} + 1`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Clear Test')._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(primaryFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .formula()
    .withId(formulaFieldId)
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .withExpression(expression)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  return { table, tableId, baseId, primaryFieldId, formulaFieldId };
};

const buildProjectionTable = () => {
  const baseId = BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
  const firstFieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
  const secondFieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Clear Projection Test')._unsafeUnwrap());
  builder
    .field()
    .number()
    .withId(firstFieldId)
    .withName(FieldName.create('First')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(secondFieldId)
    .withName(FieldName.create('Second')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  return { table, tableId, firstFieldId, secondFieldId };
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];

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
    if (!match)
      return err({
        code: 'not_found',
        message: 'Table not found',
        tags: ['not-found'],
        toString: () => 'Table not found',
      });
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
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  updatedRecords: TableRecord[] = [];
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
    ___: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>
  ): Promise<Result<{ totalInserted: number }, DomainError>> {
    return ok({ totalInserted: 0 });
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
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    this.updateCalls += 1;
    let totalUpdated = 0;
    for (const batchResult of batches) {
      if (batchResult.isErr()) {
        return err(batchResult.error);
      }
      for (const update of batchResult.value) {
        this.updatedRecords.push(update.record);
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
  lastFindStreamOptions?: ITableRecordQueryStreamOptions;

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
      return err({
        code: 'not_found',
        message: 'Record not found',
        tags: ['not-found'],
        toString: () => 'Record not found',
      });
    return ok(this.records[0]!);
  }

  findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    this.lastFindStreamOptions = options;
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
    return work({ ...context, transaction });
  }
}

describe('ClearHandler', () => {
  it('clears editable fields and publishes batch updated event', async () => {
    const { table, tableId, primaryFieldId, formulaFieldId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    const recordId = `rec${'r'.repeat(16)}`;
    const existingVersion = 3;
    recordQueryRepository.records = [
      {
        id: recordId,
        version: existingVersion,
        fields: {
          [primaryFieldId.toString()]: 10,
          [formulaFieldId.toString()]: 11,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();

    const handler = new ClearHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      eventBus,
      noopUndoRedoService,
      unitOfWork
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [1, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(1);

    expect(recordRepository.updatedRecords).toHaveLength(1);
    const updated = recordRepository.updatedRecords[0]!;
    const updatedValue = updated.fields().get(primaryFieldId)?.toValue();
    expect(updatedValue).toBeNull();

    const event = eventBus.published.find((entry) => entry instanceof RecordsBatchUpdated) as
      | RecordsBatchUpdated
      | undefined;
    expect(event).toBeDefined();
    expect(event!.updates[0]?.recordId).toBe(recordId);
    expect(event!.updates[0]?.oldVersion).toBe(existingVersion);
    expect(event!.updates[0]?.newVersion).toBe(existingVersion + 1);
  });

  it('returns 0 when only computed columns are selected', async () => {
    const { table, tableId } = buildTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);

    const handler = new ClearHandler(
      new TableQueryService(tableRepository),
      new FakeTableRecordRepository(),
      new FakeTableRecordQueryRepository(),
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [1, 0],
        [1, 0],
      ],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(0);
  });

  it('uses projection order when mapping clear column indices', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);

    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'s'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 100,
          [secondFieldId.toString()]: 200,
        },
      },
    ];

    const recordRepository = new FakeTableRecordRepository();
    const handler = new ClearHandler(
      tableQueryService,
      recordRepository,
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      projection: [secondFieldId.toString(), firstFieldId.toString()],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().updatedCount).toBe(1);
    const updated = recordRepository.updatedRecords[0]!;
    expect(updated.fields().get(secondFieldId)?.toValue()).toBeNull();
    expect(updated.fields().get(firstFieldId)).toBeUndefined();
  });

  it('uses request groupBy when resolving clear row order', async () => {
    const { table, tableId, firstFieldId, secondFieldId } = buildProjectionTable();
    const viewId = table.views()[0]!.id();

    const tableRepository = new FakeTableRepository();
    tableRepository.tables.push(table);
    const tableQueryService = new TableQueryService(tableRepository);
    const recordQueryRepository = new FakeTableRecordQueryRepository();
    recordQueryRepository.records = [
      {
        id: `rec${'t'.repeat(16)}`,
        version: 1,
        fields: {
          [firstFieldId.toString()]: 1,
          [secondFieldId.toString()]: 2,
        },
      },
    ];

    const handler = new ClearHandler(
      tableQueryService,
      new FakeTableRecordRepository(),
      recordQueryRepository,
      new FakeEventBus(),
      noopUndoRedoService,
      new FakeUnitOfWork()
    );

    const command = ClearCommand.create({
      tableId: tableId.toString(),
      viewId: viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
      groupBy: [{ fieldId: secondFieldId.toString(), order: 'desc' }],
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const orderBy = recordQueryRepository.lastFindStreamOptions?.orderBy;
    expect(orderBy?.length).toBeGreaterThan(0);
    const firstOrder = orderBy?.[0];
    expect(firstOrder && 'fieldId' in firstOrder).toBe(true);
    if (firstOrder && 'fieldId' in firstOrder) {
      expect(firstOrder.fieldId.toString()).toBe(secondFieldId.toString());
      expect(firstOrder.direction).toBe('desc');
    }
  });
});
