import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldDeletionSideEffectService } from '../application/services/FieldDeletionSideEffectService';
import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import type { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DomainEventName } from '../domain/shared/DomainEventName';
import { OccurredAt } from '../domain/shared/OccurredAt';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { FieldDeleteSnapshotSinkInput } from '../ports/FieldDeleteSnapshotSink';
import { FieldOperationKind } from '../ports/FieldOperationPlugin';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import type { TableProvisionOperationOptions, TableProvisionState } from '../ports/TableRepository';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { flattenUndoRedoCommands, type UndoRedoCommandData } from '../ports/UndoRedoStore';
import { DeleteFieldsCommand } from './DeleteFieldsCommand';
import { DeleteFieldsHandler } from './DeleteFieldsHandler';
import {
  createFieldOperationPluginRunner,
  createTrackedFieldOperationPlugin,
} from './fieldOperationPluginRunnerTestUtils';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildEvent = (): IDomainEvent => ({
  name: DomainEventName.fieldDeleted(),
  occurredAt: OccurredAt.now(),
});

const fieldIdsFromDeleteContexts = (
  contexts: ReadonlyArray<{ kind: string; payload: unknown }>
): string[] =>
  contexts.map((context) => {
    expect(context.kind).toBe(FieldOperationKind.delete);
    return (context.payload as { fieldId: FieldId }).fieldId.toString();
  });

const snapshotFieldIds = (commands: ReadonlyArray<UndoRedoCommandData>): string[] =>
  commands.map((command) => {
    expect(command.type).toBe('ApplyFieldSnapshot');
    if (command.type !== 'ApplyFieldSnapshot') {
      throw new Error('Expected ApplyFieldSnapshot command');
    }
    return command.payload.snapshot.field.id;
  });

const deleteFieldIds = (commands: ReadonlyArray<UndoRedoCommandData>): string[] =>
  commands.map((command) => {
    expect(command.type).toBe('DeleteField');
    if (command.type !== 'DeleteField') {
      throw new Error('Expected DeleteField command');
    }
    return command.payload.fieldId;
  });

const buildTable = (baseId: BaseId, tableId: TableId, fieldIds: readonly FieldId[]) => {
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create('Delete Fields Table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(createFieldId('p'))
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();

  for (const [index, fieldId] of fieldIds.entries()) {
    builder
      .field()
      .number()
      .withId(fieldId)
      .withName(FieldName.create(`Field ${index + 1}`)._unsafeUnwrap())
      .done();
  }

  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  updated: Table[] = [];
  provisionStates: Array<{ table: Table; state: TableProvisionState }> = [];
  findCalls = 0;

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
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.findCalls += 1;
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }

  async updateOne(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    this.updated.push(table);
    this.tables = this.tables.map((current) => (current.id().equals(table.id()) ? table : current));
    return ok(undefined);
  }

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async setProvisionState(
    _: IExecutionContext,
    table: Table,
    state: TableProvisionState,
    __?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    this.provisionStates.push({ table, state });
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  updated: Table[] = [];

  async insert(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    this.updated.push(table);
    return ok(table);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
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

class FakeFieldDeletionSideEffectService {
  calls: Array<{ table: Table; fields: ReadonlyArray<FieldId> }> = [];
  events: IDomainEvent[] = [];

  async execute(
    _: IExecutionContext,
    input: { table: Table; fields: ReadonlyArray<Field>; foreignTables: ReadonlyArray<Table> }
  ): Promise<Result<{ events: ReadonlyArray<IDomainEvent>; appliedDeletions: [] }, DomainError>> {
    this.calls.push({
      table: input.table,
      fields: input.fields.map((field) => field.id()),
    });
    return ok({ events: [...this.events], appliedDeletions: [] });
  }
}

class FakeForeignTableLoaderService {
  calls: Array<{ references: ReadonlyArray<unknown> }> = [];

  async load(
    _: IExecutionContext,
    input: { references: ReadonlyArray<unknown> }
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.calls.push({ references: [...input.references] });
    return ok([]);
  }
}

class FakeFieldUndoRedoSnapshotService {
  captured: Array<{ tableId: TableId; fieldId: FieldId; includeRecords?: boolean }> = [];
  captureManyCalls: Array<{ tableId: TableId; fieldIds: ReadonlyArray<FieldId> }> = [];

  async capture(
    _: IExecutionContext,
    table: Table,
    fieldId: FieldId,
    options?: { includeRecords?: boolean }
  ) {
    this.captured.push({
      tableId: table.id(),
      fieldId,
      includeRecords: options?.includeRecords,
    });
    return ok({
      field: {
        id: fieldId.toString(),
        name: `Snapshot ${fieldId.toString()}`,
        type: 'singleLineText',
      },
      views: [],
    });
  }

  async captureMany(_: IExecutionContext, table: Table, fieldIds: ReadonlyArray<FieldId>) {
    this.captureManyCalls.push({ tableId: table.id(), fieldIds: [...fieldIds] });
    return ok(
      fieldIds.map((fieldId) => ({
        field: {
          id: fieldId.toString(),
          name: `Snapshot ${fieldId.toString()}`,
          type: 'singleLineText',
        },
        views: [],
      }))
    );
  }
}

class FakeUndoRedoService {
  entries: Array<{
    tableId: TableId;
    entry: {
      undoCommand: UndoRedoCommandData;
      redoCommand: UndoRedoCommandData;
    };
  }> = [];

  async appendEntry(
    _: IExecutionContext,
    tableId: TableId,
    entry: { undoCommand: UndoRedoCommandData; redoCommand: UndoRedoCommandData }
  ) {
    this.entries.push({ tableId, entry });
    return ok(undefined);
  }
}

class FakeFieldDeleteSnapshotSink {
  calls: FieldDeleteSnapshotSinkInput[] = [];
  completions = 0;

  async prepare(_: IExecutionContext, input: FieldDeleteSnapshotSinkInput) {
    this.calls.push(input);
    return ok({
      complete: () => {
        this.completions += 1;
        return Promise.resolve(ok(undefined));
      },
    });
  }
}

const createHarness = (table: Table) => {
  const tableRepository = new FakeTableRepository();
  tableRepository.tables.push(table);
  const schemaRepository = new FakeTableSchemaRepository();
  const eventBus = new FakeEventBus();
  const unitOfWork = new FakeUnitOfWork();
  const tableUpdateFlow = new TableUpdateFlow(
    tableRepository,
    schemaRepository,
    eventBus,
    unitOfWork
  );
  const sideEffectService = new FakeFieldDeletionSideEffectService();
  sideEffectService.events = [buildEvent()];
  const foreignTableLoader = new FakeForeignTableLoaderService();
  const snapshotService = new FakeFieldUndoRedoSnapshotService();
  const undoRedoService = new FakeUndoRedoService();
  const fieldDeleteSnapshotSink = new FakeFieldDeleteSnapshotSink();

  return {
    tableRepository,
    schemaRepository,
    eventBus,
    unitOfWork,
    tableUpdateFlow,
    sideEffectService,
    foreignTableLoader,
    snapshotService,
    undoRedoService,
    fieldDeleteSnapshotSink,
  };
};

describe('DeleteFieldsHandler', () => {
  it('bulk deletes fields once while preserving plugins and undo/redo commands', async () => {
    const baseId = createBaseId('a');
    const tableId = createTableId('a');
    const targetFieldA = createFieldId('b');
    const targetFieldB = createFieldId('c');
    const initialTable = buildTable(baseId, tableId, [targetFieldA, targetFieldB]);
    const harness = createHarness(initialTable);
    const { plugin, calls } = createTrackedFieldOperationPlugin([FieldOperationKind.delete]);
    const handler = new DeleteFieldsHandler(
      harness.tableRepository,
      harness.tableUpdateFlow,
      harness.sideEffectService as unknown as FieldDeletionSideEffectService,
      harness.foreignTableLoader as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner([plugin]),
      harness.snapshotService as unknown as FieldUndoRedoSnapshotService,
      harness.undoRedoService as unknown as UndoRedoStackService,
      harness.fieldDeleteSnapshotSink
    );

    const command = DeleteFieldsCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldIds: [targetFieldA.toString(), targetFieldB.toString(), targetFieldA.toString()],
    })._unsafeUnwrap();
    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    const payload = result._unsafeUnwrap();
    expect(payload.table.getFields((field) => field.id().equals(targetFieldA))).toHaveLength(0);
    expect(payload.table.getFields((field) => field.id().equals(targetFieldB))).toHaveLength(0);
    expect(payload.events.length).toBeGreaterThan(0);

    expect(harness.tableRepository.updated).toHaveLength(1);
    expect(harness.schemaRepository.updated).toHaveLength(1);
    expect(harness.tableRepository.findCalls).toBe(2);
    expect(harness.sideEffectService.calls).toHaveLength(1);
    expect(harness.sideEffectService.calls[0]?.fields.map((fieldId) => fieldId.toString())).toEqual(
      [targetFieldA.toString(), targetFieldB.toString()]
    );

    expect(harness.snapshotService.captureManyCalls).toHaveLength(1);
    expect(
      harness.snapshotService.captureManyCalls[0]?.fieldIds.map((fieldId) => fieldId.toString())
    ).toEqual([targetFieldA.toString(), targetFieldB.toString()]);
    expect(harness.snapshotService.captured).toHaveLength(0);
    expect(harness.fieldDeleteSnapshotSink.calls).toHaveLength(1);
    expect(harness.fieldDeleteSnapshotSink.calls[0]?.fieldIds).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);
    expect(
      harness.fieldDeleteSnapshotSink.calls[0]?.snapshots.map((item) => item.snapshot.field.id)
    ).toEqual([targetFieldA.toString(), targetFieldB.toString()]);
    expect(harness.fieldDeleteSnapshotSink.completions).toBe(1);

    expect(fieldIdsFromDeleteContexts(calls.prepare)).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);
    expect(fieldIdsFromDeleteContexts(calls.guard)).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);
    expect(fieldIdsFromDeleteContexts(calls.beforePersist)).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);
    expect(calls.beforePersist.every((context) => context.isTransactionBound)).toBe(true);
    expect(fieldIdsFromDeleteContexts(calls.afterCommit)).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);

    expect(harness.undoRedoService.entries).toHaveLength(1);
    const entry = harness.undoRedoService.entries[0];
    expect(entry?.tableId.equals(tableId)).toBe(true);

    const undoLeaves = flattenUndoRedoCommands(entry!.entry.undoCommand);
    expect(undoLeaves.map((leaf) => leaf.type)).toEqual([
      'ApplyFieldSnapshot',
      'ApplyFieldSnapshot',
    ]);
    expect(snapshotFieldIds(undoLeaves)).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);

    const redoLeaves = flattenUndoRedoCommands(entry!.entry.redoCommand);
    expect(redoLeaves.map((leaf) => leaf.type)).toEqual(['DeleteField', 'DeleteField']);
    expect(deleteFieldIds(redoLeaves)).toEqual([targetFieldA.toString(), targetFieldB.toString()]);
  });

  it('returns not found before updating or recording undo/redo when a target field is missing', async () => {
    const baseId = createBaseId('f');
    const tableId = createTableId('f');
    const targetFieldA = createFieldId('g');
    const missingField = createFieldId('h');
    const initialTable = buildTable(baseId, tableId, [targetFieldA]);
    const harness = createHarness(initialTable);
    const handler = new DeleteFieldsHandler(
      harness.tableRepository,
      harness.tableUpdateFlow,
      harness.sideEffectService as unknown as FieldDeletionSideEffectService,
      harness.foreignTableLoader as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      harness.snapshotService as unknown as FieldUndoRedoSnapshotService,
      harness.undoRedoService as unknown as UndoRedoStackService,
      harness.fieldDeleteSnapshotSink
    );

    const command = DeleteFieldsCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldIds: [targetFieldA.toString(), missingField.toString()],
    })._unsafeUnwrap();
    const result = await handler.handle(createContext(), command);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toBe('Field not found');
    expect(harness.tableRepository.updated).toHaveLength(0);
    expect(harness.schemaRepository.updated).toHaveLength(0);
    expect(harness.snapshotService.captureManyCalls).toHaveLength(0);
    expect(harness.fieldDeleteSnapshotSink.calls).toHaveLength(0);
    expect(harness.undoRedoService.entries).toHaveLength(0);
  });

  it('does not prepare delete snapshots during undo/redo replay', async () => {
    const baseId = createBaseId('i');
    const tableId = createTableId('i');
    const targetFieldA = createFieldId('j');
    const initialTable = buildTable(baseId, tableId, [targetFieldA]);
    const harness = createHarness(initialTable);
    const handler = new DeleteFieldsHandler(
      harness.tableRepository,
      harness.tableUpdateFlow,
      harness.sideEffectService as unknown as FieldDeletionSideEffectService,
      harness.foreignTableLoader as unknown as ForeignTableLoaderService,
      createFieldOperationPluginRunner(),
      harness.snapshotService as unknown as FieldUndoRedoSnapshotService,
      harness.undoRedoService as unknown as UndoRedoStackService,
      harness.fieldDeleteSnapshotSink
    );

    const commandResult = DeleteFieldsCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldIds: [targetFieldA.toString()],
    });

    const result = await handler.handle(
      { ...createContext(), undoRedo: { mode: 'redo' } },
      commandResult._unsafeUnwrap()
    );

    expect(result.isOk()).toBe(true);
    expect(harness.fieldDeleteSnapshotSink.calls).toHaveLength(0);
  });
});
