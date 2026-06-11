import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import type { UndoRedoStackService } from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DomainEventName } from '../domain/shared/DomainEventName';
import { OccurredAt } from '../domain/shared/OccurredAt';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { ICommandBus } from '../ports/CommandBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type { ITableRepository } from '../ports/TableRepository';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  flattenUndoRedoCommands,
  type UndoRedoCommandData,
} from '../ports/UndoRedoStore';
import type { DeleteFieldCommand } from './DeleteFieldCommand';
import { DeleteFieldResult } from './DeleteFieldHandler';
import { DeleteFieldsCommand } from './DeleteFieldsCommand';
import { DeleteFieldsHandler } from './DeleteFieldsHandler';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildEvent = (name = 'Field deleted'): IDomainEvent => ({
  name: DomainEventName.fieldDeleted(),
  occurredAt: OccurredAt.now(),
  payload: { name },
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
  constructor(private readonly table: Table) {}

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(this.table);
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([this.table]);
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

class FakeCommandBus implements ICommandBus {
  calls: DeleteFieldCommand[] = [];

  constructor(private readonly results: Array<Result<DeleteFieldResult, DomainError>>) {}

  async execute<TCommand, TResult>(
    _: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>> {
    this.calls.push(command as DeleteFieldCommand);
    const next = this.results.shift();
    if (!next) {
      return err(domainError.invariant({ message: 'Missing nested delete result' }));
    }
    return next as Result<TResult, DomainError>;
  }
}

class FakeFieldUndoRedoSnapshotService {
  calls: string[] = [];

  async capture(_: IExecutionContext, __: Table, fieldId: FieldId) {
    this.calls.push(fieldId.toString());
    return ok({
      field: {
        id: fieldId.toString(),
        name: `Snapshot ${fieldId.toString()}`,
        type: 'singleLineText',
      },
      views: [],
    });
  }
}

class FakeUndoRedoService {
  entries: Array<{
    tableId: TableId;
    entry: {
      undoCommand: unknown;
      redoCommand: unknown;
    };
  }> = [];

  async appendEntry(
    _: IExecutionContext,
    tableId: TableId,
    entry: { undoCommand: unknown; redoCommand: unknown }
  ) {
    this.entries.push({ tableId, entry });
    return ok(undefined);
  }
}

const buildApplyFieldSnapshotLeaf = (baseId: BaseId, tableId: TableId, fieldId: FieldId) =>
  createUndoRedoCommand('ApplyFieldSnapshot', {
    baseId: baseId.toString(),
    tableId: tableId.toString(),
    snapshot: {
      field: {
        id: fieldId.toString(),
        name: `Snapshot ${fieldId.toString()}`,
        type: 'singleLineText',
      },
      views: [],
    },
  });

describe('DeleteFieldsHandler', () => {
  it('deletes fields, dedupes related snapshots, and records undo/redo commands', async () => {
    const baseId = createBaseId('a');
    const tableId = createTableId('a');
    const targetFieldA = createFieldId('b');
    const targetFieldB = createFieldId('c');
    const relatedFieldX = createFieldId('d');
    const relatedFieldY = createFieldId('e');
    const initialTable = buildTable(baseId, tableId, [targetFieldA, targetFieldB, relatedFieldX]);
    const latestTable = buildTable(baseId, tableId, [relatedFieldY]);

    const nestedResults: Array<Result<DeleteFieldResult, DomainError>> = [
      ok(
        DeleteFieldResult.create(
          initialTable,
          [buildEvent('first')],
          composeUndoRedoCommands([
            buildApplyFieldSnapshotLeaf(baseId, tableId, targetFieldA),
            buildApplyFieldSnapshotLeaf(baseId, tableId, relatedFieldX),
            createUndoRedoCommand('DeleteField', {
              baseId: baseId.toString(),
              tableId: tableId.toString(),
              fieldId: targetFieldA.toString(),
            }),
          ]),
          createUndoRedoCommand('DeleteField', {
            baseId: baseId.toString(),
            tableId: tableId.toString(),
            fieldId: targetFieldA.toString(),
          })
        )
      ),
      ok(
        DeleteFieldResult.create(
          latestTable,
          [buildEvent('second')],
          composeUndoRedoCommands([
            buildApplyFieldSnapshotLeaf(baseId, tableId, targetFieldB),
            buildApplyFieldSnapshotLeaf(baseId, tableId, relatedFieldX),
            buildApplyFieldSnapshotLeaf(baseId, tableId, relatedFieldY),
          ]),
          createUndoRedoCommand('DeleteField', {
            baseId: baseId.toString(),
            tableId: tableId.toString(),
            fieldId: targetFieldB.toString(),
          })
        )
      ),
    ];

    const commandBus = new FakeCommandBus(nestedResults);
    const tableRepository = new FakeTableRepository(initialTable);
    const snapshotService = new FakeFieldUndoRedoSnapshotService();
    const undoRedoService = new FakeUndoRedoService();
    const handler = new DeleteFieldsHandler(
      commandBus,
      tableRepository,
      snapshotService as unknown as FieldUndoRedoSnapshotService,
      undoRedoService as unknown as UndoRedoStackService
    );

    const commandResult = DeleteFieldsCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldIds: [targetFieldA.toString(), targetFieldB.toString(), targetFieldA.toString()],
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) {
      return;
    }

    const result = await handler.handle(createContext(), commandResult.value);

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(commandBus.calls).toHaveLength(2);
    expect(commandBus.calls.map((command) => command.fieldId.toString())).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);
    expect(commandBus.calls.every((command) => command.skipUndoRedo())).toBe(true);
    expect(snapshotService.calls).toEqual([targetFieldA.toString(), targetFieldB.toString()]);
    expect(result.value.table).toBe(latestTable);
    expect(result.value.events).toHaveLength(2);

    expect(undoRedoService.entries).toHaveLength(1);
    const entry = undoRedoService.entries[0];
    expect(entry.tableId.equals(latestTable.id())).toBe(true);

    const undoLeaves = flattenUndoRedoCommands(entry.entry.undoCommand as UndoRedoCommandData);
    expect(
      undoLeaves
        .filter((leaf) => leaf.type === 'ApplyFieldSnapshot')
        .map((leaf) => leaf.payload.snapshot.field.id)
    ).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
      relatedFieldX.toString(),
      relatedFieldY.toString(),
    ]);

    const redoLeaves = flattenUndoRedoCommands(entry.entry.redoCommand as UndoRedoCommandData);
    expect(redoLeaves.map((leaf) => leaf.type)).toEqual(['DeleteField', 'DeleteField']);
    expect(redoLeaves.map((leaf) => leaf.payload.fieldId)).toEqual([
      targetFieldA.toString(),
      targetFieldB.toString(),
    ]);
  });

  it('returns the nested delete error and skips undo/redo recording', async () => {
    const baseId = createBaseId('f');
    const tableId = createTableId('f');
    const targetFieldA = createFieldId('g');
    const targetFieldB = createFieldId('h');
    const initialTable = buildTable(baseId, tableId, [targetFieldA, targetFieldB]);

    const commandBus = new FakeCommandBus([
      err(domainError.validation({ message: 'nested delete failed' })),
    ]);
    const tableRepository = new FakeTableRepository(initialTable);
    const snapshotService = new FakeFieldUndoRedoSnapshotService();
    const undoRedoService = new FakeUndoRedoService();
    const handler = new DeleteFieldsHandler(
      commandBus,
      tableRepository,
      snapshotService as unknown as FieldUndoRedoSnapshotService,
      undoRedoService as unknown as UndoRedoStackService
    );

    const commandResult = DeleteFieldsCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      fieldIds: [targetFieldA.toString(), targetFieldB.toString()],
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) {
      return;
    }

    const result = await handler.handle(createContext(), commandResult.value);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('nested delete failed');
    expect(undoRedoService.entries).toHaveLength(0);
  });
});
