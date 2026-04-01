import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
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
import type {
  BatchRecordMutationResult,
  InsertManyStreamOptions,
  ITableRecordRepository,
  RecordMutationResult,
  UpdateManyStreamResult,
} from '../ports/TableRecordRepository';
import type { ITableRepository } from '../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { RestoreRecordsCommand } from './RestoreRecordsCommand';
import { RestoreRecordsHandler } from './RestoreRecordsHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'r'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'s'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Restore Records')._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    textFieldId,
  };
};

const createCommand = (tableId: string, textFieldId: string, overrides?: Record<string, unknown>) =>
  RestoreRecordsCommand.create({
    tableId,
    records: [
      {
        recordId: `rec${'u'.repeat(14)}01`,
        fields: {
          [textFieldId]: 'Restored value',
        },
        orders: {
          [`viw${'v'.repeat(14)}01`]: 3,
        },
        autoNumber: 8,
        createdTime: '2025-01-01T00:00:00.000Z',
        createdBy: `usr${'w'.repeat(16)}`,
        lastModifiedTime: '2025-01-02T00:00:00.000Z',
        lastModifiedBy: `usr${'x'.repeat(16)}`,
        ...overrides,
      },
    ],
  })._unsafeUnwrap();

class FakeTableRepository implements ITableRepository {
  constructor(private readonly tables: Table[]) {}

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(tables);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const table = this.tables.find((candidate) => spec.isSatisfiedBy(candidate));
    if (!table) {
      return err(domainError.notFound({ message: 'Table not found' }));
    }
    return ok(table);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    __?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  inserted: TableRecord[] = [];
  lastInsertOptions: Parameters<ITableRecordRepository['insertMany']>[3] | undefined;

  async insert(): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }

  async insertMany(
    _: IExecutionContext,
    __: Table,
    records: ReadonlyArray<TableRecord>,
    options?: Parameters<ITableRecordRepository['insertMany']>[3]
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    this.inserted.push(...records);
    this.lastInsertOptions = options;
    return ok({});
  }

  async insertManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    ____?: InsertManyStreamOptions
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

  async updateMany(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    ____: ICellValueSpec
  ): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    ___: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    return ok({ totalUpdated: 0 });
  }

  async deleteMany(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  publishedMany: ReadonlyArray<IDomainEvent>[] = [];

  async publish(_: IExecutionContext, __: IDomainEvent): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.publishedMany.push(events);
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

describe('RestoreRecordsHandler', () => {
  it('restores records with system metadata and publishes batch created', async () => {
    const { table, textFieldId } = buildTable();
    const tableQueryService = new TableQueryService(new FakeTableRepository([table]));
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const handler = new RestoreRecordsHandler(
      tableQueryService,
      tableRecordRepository,
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      eventBus,
      new FakeUnitOfWork()
    );

    const command = createCommand(table.id().toString(), textFieldId.toString());
    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().restoredCount).toBe(1);
    expect(tableRecordRepository.inserted).toHaveLength(1);
    expect(
      tableRecordRepository.lastInsertOptions?.restoreRecordsById?.get(command.records[0]!.recordId)
    ).toEqual({
      orders: command.records[0]!.orders,
      autoNumber: 8,
      createdTime: '2025-01-01T00:00:00.000Z',
      createdBy: `usr${'w'.repeat(16)}`,
      lastModifiedTime: '2025-01-02T00:00:00.000Z',
      lastModifiedBy: `usr${'x'.repeat(16)}`,
    });
    expect(tableRecordRepository.lastInsertOptions?.cleanupTrashRecordIds).toEqual([
      command.records[0]!.recordId,
    ]);
    expect(eventBus.publishedMany).toHaveLength(1);
    expect(eventBus.publishedMany[0]).toHaveLength(1);
    expect(eventBus.publishedMany[0]?.[0]).toBeInstanceOf(RecordsBatchCreated);
  });

  it('persists table side effects before restore and publishes both event groups', async () => {
    const { table, textFieldId } = buildTable();
    const tableQueryService = new TableQueryService(new FakeTableRepository([table]));
    const tableRecordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const sideEffectEvent = { type: 'restore.table.side-effect' } as IDomainEvent;
    let tableUpdateFlowCalls = 0;

    const handler = new RestoreRecordsHandler(
      tableQueryService,
      tableRecordRepository,
      {
        execute: () =>
          ok({
            table,
            updateResult: {
              table,
              events: [sideEffectEvent],
            },
          }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => {
          tableUpdateFlowCalls += 1;
          return ok({ table, events: [sideEffectEvent] });
        },
      } as unknown as TableUpdateFlow,
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString(), {
        orders: undefined,
        autoNumber: undefined,
      })
    );

    expect(result.isOk()).toBe(true);
    expect(tableUpdateFlowCalls).toBe(1);
    expect(eventBus.publishedMany).toHaveLength(1);
    expect(eventBus.publishedMany[0]).toHaveLength(2);
    expect(eventBus.publishedMany[0]?.[0]).toBe(sideEffectEvent);
    expect(eventBus.publishedMany[0]?.[1]).toBeInstanceOf(RecordsBatchCreated);
  });

  it('fails before transaction when record ids are invalid', async () => {
    const { table, textFieldId } = buildTable();
    const tableQueryService = new TableQueryService(new FakeTableRepository([table]));
    const tableRecordRepository = new FakeTableRecordRepository();
    const unitOfWork = new FakeUnitOfWork();
    const handler = new RestoreRecordsHandler(
      tableQueryService,
      tableRecordRepository,
      {
        execute: () => ok({ table, updateResult: undefined }),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new FakeEventBus(),
      unitOfWork
    );

    const command = createCommand(table.id().toString(), textFieldId.toString(), {
      recordId: 'invalid-record-id',
    });
    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(tableRecordRepository.inserted).toHaveLength(0);
    expect(unitOfWork.transactions).toHaveLength(0);
  });

  it('propagates side effect failures without attempting restore', async () => {
    const { table, textFieldId } = buildTable();
    const tableQueryService = new TableQueryService(new FakeTableRepository([table]));
    const tableRecordRepository = new FakeTableRecordRepository();
    const unitOfWork = new FakeUnitOfWork();
    const restoreError = domainError.validation({
      code: 'restore.side_effect_failed',
      message: 'side effect failed',
    });
    const handler = new RestoreRecordsHandler(
      tableQueryService,
      tableRecordRepository,
      {
        execute: () => err(restoreError),
      } as unknown as RecordWriteSideEffectService,
      {
        execute: async () => ok({ table, events: [] }),
      } as unknown as TableUpdateFlow,
      new FakeEventBus(),
      unitOfWork
    );

    const result = await handler.handle(
      createContext(),
      createCommand(table.id().toString(), textFieldId.toString())
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('restore.side_effect_failed');
    expect(tableRecordRepository.inserted).toHaveLength(0);
    expect(unitOfWork.transactions).toHaveLength(0);
  });
});
