import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { BaseId } from '../../domain/base/BaseId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { DbFieldName } from '../../domain/table/fields/DbFieldName';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRecordQueryStreamOptions } from '../../ports/TableRecordQueryRepository';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import type { ITableRepository, TableUpdatePersistResult } from '../../ports/TableRepository';
import type {
  ITableRecordRepository,
  UpdateManyStreamBatchInput,
  UpdateManyStreamResult,
} from '../../ports/TableRecordRepository';
import type { TableSortKey } from '../../ports/TableSortKey';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { CreateFieldCommand } from '../../commands/CreateFieldCommand';
import { UpdateFieldCommand } from '../../commands/UpdateFieldCommand';
import { ApplyFieldSnapshotCommand } from '../../commands/ApplyFieldSnapshotCommand';
import { isRecordsBatchUpdatedEvent } from '../../domain/table/events/RecordsBatchUpdated';
import { GridView } from '../../domain/table/views/types/GridView';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewId } from '../../domain/table/views/ViewId';
import { ViewName } from '../../domain/table/views/ViewName';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { ICommandBus } from '../../ports/CommandBus';
import type { IEventBus } from '../../ports/EventBus';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';

import { FieldUndoRedoReplayService } from './FieldUndoRedoReplayService';

const buildContext = (): IExecutionContext => ({
  actorId: ActorId.create('actor')._unsafeUnwrap(),
  windowId: 'window-1',
  requestId: 'req-1',
});

const buildTable = (withRestoredField: boolean): { table: Table; restoredFieldId: FieldId } => {
  const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'n'.repeat(16)}`)._unsafeUnwrap();
  const titleField = SingleLineTextField.create({
    id: FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Title')._unsafeUnwrap(),
  })._unsafeUnwrap();
  titleField
    .setDbFieldName(DbFieldName.rehydrate(titleField.id().toString())._unsafeUnwrap())
    ._unsafeUnwrap();
  const restoredFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
  const fields = [titleField];

  if (withRestoredField) {
    const restoredField = NumberField.create({
      id: restoredFieldId,
      name: FieldName.create('Score')._unsafeUnwrap(),
    })._unsafeUnwrap();
    restoredField
      .setDbFieldName(DbFieldName.rehydrate(restoredField.id().toString())._unsafeUnwrap())
      ._unsafeUnwrap();
    fields.push(restoredField);
  }

  const view = GridView.create({
    id: ViewId.create(`viw${'q'.repeat(16)}`)._unsafeUnwrap(),
    name: ViewName.create('Grid')._unsafeUnwrap(),
  })._unsafeUnwrap();
  view
    .setColumnMeta(
      ViewColumnMeta.forView({
        viewType: view.type(),
        fields,
        primaryFieldId: titleField.id(),
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view.setQueryDefaults(ViewQueryDefaults.empty())._unsafeUnwrap();

  return {
    table: Table.rehydrate({
      id: tableId,
      baseId,
      name: TableName.create('Undo Replay')._unsafeUnwrap(),
      fields,
      views: [view],
      primaryFieldId: titleField.id(),
    })._unsafeUnwrap(),
    restoredFieldId,
  };
};

class FakeTableRepository implements ITableRepository {
  constructor(private readonly tables: Table[]) {}
  private readIndex = 0;

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([...tables]);
  }

  async findOne(): Promise<Result<Table, DomainError>> {
    const table = this.tables[Math.min(this.readIndex, this.tables.length - 1)];
    this.readIndex += 1;
    if (!table) {
      return err(domainError.notFound({ message: 'not found' }));
    }
    return ok(table);
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([]);
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<TableUpdatePersistResult | void, DomainError>> {
    return ok(undefined);
  }

  async restore(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeCommandBus implements ICommandBus {
  readonly commands: unknown[] = [];

  async execute<TCommand, TResult>(
    _: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>> {
    this.commands.push(command);
    return ok(undefined as TResult);
  }
}

class FakeTableRecordQueryRepository implements ITableRecordQueryRepository {
  rows: TableRecordReadModel[] = [];

  async find(): Promise<
    Result<{ records: ReadonlyArray<TableRecordReadModel>; total: number }, DomainError>
  > {
    throw new Error('Not used in test');
  }

  async findOne(): Promise<Result<TableRecordReadModel, DomainError>> {
    throw new Error('Not used in test');
  }

  async *findStream(
    _: IExecutionContext,
    __: Table,
    ___?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    ____?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    for (const row of this.rows) {
      yield ok(row);
    }
  }
}

class FakeTableRecordRepository implements ITableRecordRepository {
  updatedBatches: UpdateManyStreamBatchInput[] = [];

  async insert(): Promise<Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>> {
    throw new Error('Not used in test');
  }

  async insertMany(): Promise<
    Result<
      {
        computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
        recordOrders?: ReadonlyMap<string, Record<string, number>>;
      },
      DomainError
    >
  > {
    throw new Error('Not used in test');
  }

  async insertManyStream(): Promise<Result<{ totalInserted: number }, DomainError>> {
    throw new Error('Not used in test');
  }

  async update(): Promise<Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>> {
    throw new Error('Not used in test');
  }

  async updateMany(): Promise<
    Result<
      {
        totalUpdated: number;
        updatedRecordIds: readonly never[];
        updatedRecords: readonly never[];
      },
      DomainError
    >
  > {
    throw new Error('Not used in test');
  }

  async updateManyStream(
    _: IExecutionContext,
    __: Table,
    batches:
      | Iterable<Result<UpdateManyStreamBatchInput, DomainError>>
      | AsyncIterable<Result<UpdateManyStreamBatchInput, DomainError>>
  ): Promise<Result<UpdateManyStreamResult, DomainError>> {
    for await (const batch of batches as AsyncIterable<
      Result<UpdateManyStreamBatchInput, DomainError>
    >) {
      if (batch.isErr()) {
        return err(batch.error);
      }
      this.updatedBatches.push(batch.value);
    }
    return ok({ totalUpdated: this.updatedBatches.length });
  }

  async deleteMany(): Promise<Result<void, DomainError>> {
    throw new Error('Not used in test');
  }
}

class FakeEventBus implements IEventBus {
  publishedMany: IDomainEvent[][] = [];

  async publish(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.publishedMany.push([...events]);
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

class FakeTableUpdateFlow {
  calls = 0;

  async execute(
    _: IExecutionContext,
    target: { table: Table }
  ): Promise<
    Result<{ table: Table; events: IDomainEvent[]; postPersistEvents: IDomainEvent[] }, DomainError>
  > {
    this.calls += 1;
    return ok({ table: target.table, events: [], postPersistEvents: [] });
  }
}

describe('FieldUndoRedoReplayService', () => {
  it('replays snapshots onto an existing field via UpdateFieldCommand and table flow side effects', async () => {
    const { table, restoredFieldId } = buildTable(true);
    const tableRepository = new FakeTableRepository([table, table]);
    const commandBus = new FakeCommandBus();
    const tableUpdateFlow = new FakeTableUpdateFlow();
    const service = new FieldUndoRedoReplayService(
      tableRepository,
      commandBus,
      new FakeTableRecordQueryRepository(),
      new FakeTableRecordRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork(),
      tableUpdateFlow as unknown as any
    );

    const result = await service.replay(buildContext(), {
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      snapshot: {
        field: {
          id: restoredFieldId.toString(),
          name: 'Score Restored',
          type: 'number',
          notNull: false,
        },
        hasError: true,
        views: [
          {
            viewId: table.views()[0]!.id().toString(),
            columnMeta: { width: 420 },
            query: { manualSort: true },
            orderedFieldIds: [restoredFieldId.toString(), table.primaryFieldId().toString()],
          },
        ],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(commandBus.commands).toHaveLength(1);
    const command = commandBus.commands[0] as UpdateFieldCommand;
    expect(command).toBeInstanceOf(UpdateFieldCommand);
    expect(command.fieldId.toString()).toBe(restoredFieldId.toString());
    expect(command.fieldUpdate.name).toBe('Score Restored');
    expect(tableUpdateFlow.calls).toBe(2);
  });

  it('creates a missing field, replays stored values, and defers constraint restoration until after data is restored', async () => {
    const initial = buildTable(false);
    const restored = buildTable(true);
    const tableRepository = new FakeTableRepository([
      initial.table,
      restored.table,
      restored.table,
    ]);
    const commandBus = new FakeCommandBus();
    const queryRepository = new FakeTableRecordQueryRepository();
    queryRepository.rows = [
      {
        id: `rec${'r'.repeat(16)}`,
        fields: { [restored.restoredFieldId.toString()]: null },
        version: 7,
      },
    ];
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const tableUpdateFlow = new FakeTableUpdateFlow();
    const service = new FieldUndoRedoReplayService(
      tableRepository,
      commandBus,
      queryRepository,
      recordRepository,
      eventBus,
      new FakeUnitOfWork(),
      tableUpdateFlow as unknown as any
    );

    const result = await service.replay(buildContext(), {
      baseId: initial.table.baseId().toString(),
      tableId: initial.table.id().toString(),
      snapshot: {
        field: {
          id: restored.restoredFieldId.toString(),
          name: 'Score',
          type: 'number',
          notNull: true,
        },
        views: [],
        records: [{ recordId: `rec${'r'.repeat(16)}`, value: 88 }],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(commandBus.commands).toHaveLength(1);
    const command = commandBus.commands[0] as CreateFieldCommand;
    expect(command).toBeInstanceOf(CreateFieldCommand);
    expect(command.field.id).toBe(restored.restoredFieldId.toString());
    expect(command.field.notNull).toBe(false);
    expect(recordRepository.updatedBatches).toHaveLength(1);
    expect(eventBus.publishedMany).toHaveLength(1);
    expect(isRecordsBatchUpdatedEvent(eventBus.publishedMany[0]?.[0]!)).toBe(true);
    expect(tableUpdateFlow.calls).toBe(1);
  });
});
