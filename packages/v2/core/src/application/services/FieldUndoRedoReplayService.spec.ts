import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { CreateFieldCommand } from '../../commands/CreateFieldCommand';
import { UpdateFieldCommand } from '../../commands/UpdateFieldCommand';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { isRecordsBatchUpdatedEvent } from '../../domain/table/events/RecordsBatchUpdated';
import { DbFieldName } from '../../domain/table/fields/DbFieldName';
import type { Field } from '../../domain/table/fields/Field';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import { GridView } from '../../domain/table/views/types/GridView';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewId } from '../../domain/table/views/ViewId';
import { ViewName } from '../../domain/table/views/ViewName';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import type { ICommandBus } from '../../ports/CommandBus';
import type { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryStreamOptions,
} from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import {
  isUpdateManyStreamBatch,
  type ITableRecordRepository,
  type UpdateManyStreamBatchInput,
  type UpdateManyStreamResult,
} from '../../ports/TableRecordRepository';
import type { ITableRepository, TableUpdatePersistResult } from '../../ports/TableRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';

import { FieldUndoRedoReplayService } from './FieldUndoRedoReplayService';
import type { TableUpdateFlow } from './TableUpdateFlow';

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
  const fields: Field[] = [titleField];

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
  updateManyStreamUpdatedRecordIds?: ReadonlySet<string>;
  updateManyStreamVersions = new Map<string, number>();

  constructor(private readonly queryRepository?: FakeTableRecordQueryRepository) {}

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

  async updateOne(): Promise<
    Result<{ computedChanges?: ReadonlyMap<string, unknown> }, DomainError>
  > {
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
    let totalUpdated = 0;
    const updatedRecords: Array<NonNullable<UpdateManyStreamResult['updatedRecords']>[number]> = [];
    for await (const batch of batches as AsyncIterable<
      Result<UpdateManyStreamBatchInput, DomainError>
    >) {
      if (batch.isErr()) {
        return err(batch.error);
      }
      this.updatedBatches.push(batch.value);
      const updates = isUpdateManyStreamBatch(batch.value) ? batch.value.updates : batch.value;
      for (const update of updates) {
        const recordId = update.record.id().toString();
        if (
          this.updateManyStreamUpdatedRecordIds &&
          !this.updateManyStreamUpdatedRecordIds.has(recordId)
        ) {
          continue;
        }
        totalUpdated += 1;
        const storedRecord = this.queryRepository?.rows.find((item) => item.id === recordId);
        const configuredNewVersion = this.updateManyStreamVersions.get(recordId);
        const oldVersion =
          storedRecord?.version ??
          (configuredNewVersion !== undefined ? configuredNewVersion - 1 : 0);
        const oldFieldValues: Record<string, unknown> = {};
        if (storedRecord) {
          for (const entry of update.record.fields().entries()) {
            const fieldId = entry.fieldId.toString();
            if (Object.prototype.hasOwnProperty.call(storedRecord.fields, fieldId)) {
              oldFieldValues[fieldId] = storedRecord.fields[fieldId];
            }
          }
        }
        updatedRecords.push({
          recordId: update.record.id(),
          oldVersion,
          newVersion: configuredNewVersion ?? (storedRecord ? storedRecord.version + 1 : 1),
          oldFieldValues,
        });
      }
    }
    return ok({
      totalUpdated,
      updatedRecords,
    });
  }

  async deleteMany() {
    throw new Error('Not used in test');
  }

  async deleteManyStream(): Promise<Result<{ totalDeleted: number }, DomainError>> {
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

const asTableUpdateFlow = (flow: FakeTableUpdateFlow): TableUpdateFlow =>
  flow as unknown as TableUpdateFlow;

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
      asTableUpdateFlow(tableUpdateFlow)
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
    const recordRepository = new FakeTableRecordRepository(queryRepository);
    const eventBus = new FakeEventBus();
    const tableUpdateFlow = new FakeTableUpdateFlow();
    const service = new FieldUndoRedoReplayService(
      tableRepository,
      commandBus,
      queryRepository,
      recordRepository,
      eventBus,
      new FakeUnitOfWork(),
      asTableUpdateFlow(tableUpdateFlow)
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
    const publishedEvent = eventBus.publishedMany[0]?.[0];
    if (!publishedEvent) {
      throw new Error('Expected replay to publish record update event');
    }
    expect(isRecordsBatchUpdatedEvent(publishedEvent)).toBe(true);
    expect(tableUpdateFlow.calls).toBe(1);
  });

  it('skips replay when current and snapshot cell values are structurally equal', async () => {
    const { table, restoredFieldId } = buildTable(true);
    const queryRepository = new FakeTableRecordQueryRepository();
    const recordId = `rec${'s'.repeat(16)}`;
    queryRepository.rows = [
      {
        id: recordId,
        fields: {
          [restoredFieldId.toString()]: {
            id: 'usr1',
            title: 'Alice',
            email: 'alice@example.com',
          },
        },
        version: 7,
      },
    ];
    const recordRepository = new FakeTableRecordRepository();
    const eventBus = new FakeEventBus();
    const service = new FieldUndoRedoReplayService(
      new FakeTableRepository([table]),
      new FakeCommandBus(),
      queryRepository,
      recordRepository,
      eventBus,
      new FakeUnitOfWork(),
      asTableUpdateFlow(new FakeTableUpdateFlow())
    );

    const result = await service.replay(buildContext(), {
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      snapshot: {
        field: {
          id: restoredFieldId.toString(),
          name: 'Score',
          type: 'number',
        },
        views: [],
        records: [
          {
            recordId,
            value: {
              email: 'alice@example.com',
              title: 'Alice',
              id: 'usr1',
            },
          },
        ],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(recordRepository.updatedBatches).toHaveLength(0);
    expect(eventBus.publishedMany).toHaveLength(0);
  });

  it('does not publish replay update event when storage skips the row', async () => {
    const { table, restoredFieldId } = buildTable(true);
    const queryRepository = new FakeTableRecordQueryRepository();
    const recordId = `rec${'t'.repeat(16)}`;
    queryRepository.rows = [
      {
        id: recordId,
        fields: { [restoredFieldId.toString()]: null },
        version: 7,
      },
    ];
    const recordRepository = new FakeTableRecordRepository();
    recordRepository.updateManyStreamUpdatedRecordIds = new Set();
    const eventBus = new FakeEventBus();
    const service = new FieldUndoRedoReplayService(
      new FakeTableRepository([table]),
      new FakeCommandBus(),
      queryRepository,
      recordRepository,
      eventBus,
      new FakeUnitOfWork(),
      asTableUpdateFlow(new FakeTableUpdateFlow())
    );

    const result = await service.replay(buildContext(), {
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      snapshot: {
        field: {
          id: restoredFieldId.toString(),
          name: 'Score',
          type: 'number',
        },
        views: [],
        records: [{ recordId, value: 88 }],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(recordRepository.updatedBatches).toHaveLength(1);
    expect(eventBus.publishedMany).toHaveLength(0);
  });
});
