import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { FieldUndoRedoReplayService } from '../application/services/FieldUndoRedoReplayService';
import type {
  UndoRedoStackReplayContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { UndoEntry } from '../ports/UndoRedoStore';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
import { ApplyFieldSnapshotCommand } from './ApplyFieldSnapshotCommand';
import { ApplyFieldSnapshotHandler } from './ApplyFieldSnapshotHandler';
import { RedoCommand } from './RedoCommand';
import { RedoHandler } from './RedoHandler';
import { ReplayFieldTypeConversionCommand } from './ReplayFieldTypeConversionCommand';
import { ReplayFieldTypeConversionHandler } from './ReplayFieldTypeConversionHandler';
import { UndoCommand } from './UndoCommand';
import { UndoHandler } from './UndoHandler';

const buildContext = (): IExecutionContext => ({
  actorId: ActorId.create('actor')._unsafeUnwrap(),
  windowId: 'window-1',
  requestId: 'req-1',
});

const buildTable = (): Table => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Undo Redo')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = TableAggregate.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakeUndoRedoService {
  undoCalls: Array<{ context: UndoRedoStackReplayContext; tableId: string; windowId?: string }> =
    [];
  redoCalls: Array<{ context: UndoRedoStackReplayContext; tableId: string; windowId?: string }> =
    [];
  undoEntry: UndoEntry | null = null;
  redoEntry: UndoEntry | null = null;

  async applyUndo(
    context: UndoRedoStackReplayContext,
    tableId: TableId,
    windowId?: string
  ): Promise<Result<UndoEntry | null, DomainError>> {
    this.undoCalls.push({ context, tableId: tableId.toString(), windowId });
    return ok(this.undoEntry);
  }

  async applyRedo(
    context: UndoRedoStackReplayContext,
    tableId: TableId,
    windowId?: string
  ): Promise<Result<UndoEntry | null, DomainError>> {
    this.redoCalls.push({ context, tableId: tableId.toString(), windowId });
    return ok(this.redoEntry);
  }
}

class FakeFieldUndoRedoReplayService {
  readonly calls: Array<{
    context: IExecutionContext;
    params: { baseId: string; tableId: string; snapshot: ApplyFieldSnapshotCommand['snapshot'] };
  }> = [];

  constructor(private readonly table: Table) {}

  async replay(
    context: IExecutionContext,
    params: { baseId: string; tableId: string; snapshot: ApplyFieldSnapshotCommand['snapshot'] }
  ): Promise<Result<Table, DomainError>> {
    this.calls.push({ context, params });
    return ok(this.table);
  }
}

const buildEntry = (): UndoEntry => {
  const tableId = `tbl${'c'.repeat(16)}`;
  const recordId = `rec${'d'.repeat(16)}`;
  const actorId = ActorId.create('actor')._unsafeUnwrap();
  const resolvedTableId = TableId.create(tableId)._unsafeUnwrap();
  return {
    scope: {
      actorId,
      tableId: resolvedTableId,
      windowId: 'window-1',
    },
    undoCommand: createUndoRedoCommand('UpdateRecord', {
      tableId,
      recordId,
      fields: { fld1: 'old' },
      fieldKeyType: 'id',
      typecast: false,
    }),
    redoCommand: createUndoRedoCommand('UpdateRecord', {
      tableId,
      recordId,
      fields: { fld1: 'new' },
      fieldKeyType: 'id',
      typecast: false,
    }),
    createdAt: new Date().toISOString(),
  };
};

describe('undo/redo commands and handlers', () => {
  it('creates undo and redo commands from valid raw input and rejects invalid table ids', () => {
    const tableId = `tbl${'z'.repeat(16)}`;

    const undo = UndoCommand.create({ tableId, windowId: 'window-1' });
    const redo = RedoCommand.create({ tableId });

    expect(undo.isOk()).toBe(true);
    expect(undo._unsafeUnwrap().tableId.toString()).toBe(tableId);
    expect(undo._unsafeUnwrap().windowId).toBe('window-1');
    expect(redo.isOk()).toBe(true);
    expect(redo._unsafeUnwrap().tableId.toString()).toBe(tableId);

    const invalidUndo = UndoCommand.create({ tableId: 'bad' });
    const invalidRedo = RedoCommand.create({ tableId: 'bad' });

    expect(invalidUndo.isErr()).toBe(true);
    expect(invalidUndo._unsafeUnwrapErr().message).toContain('Invalid');
    expect(invalidRedo.isErr()).toBe(true);
    expect(invalidRedo._unsafeUnwrapErr().message).toContain('Invalid');
  });

  it('delegates undo and redo handling to the undo/redo service', async () => {
    const context = buildContext();
    const entry = buildEntry();
    const service = new FakeUndoRedoService();
    service.undoEntry = entry;
    service.redoEntry = entry;
    const tableId = entry.scope.tableId.toString();

    const undoHandler = new UndoHandler(service as unknown as UndoRedoStackService);
    const redoHandler = new RedoHandler(service as unknown as UndoRedoStackService);
    const undoCommand = UndoCommand.create({ tableId, windowId: 'window-2' })._unsafeUnwrap();
    const redoCommand = RedoCommand.create({ tableId })._unsafeUnwrap();

    const undoResult = await undoHandler.handle(context, undoCommand);
    const redoResult = await redoHandler.handle(context, redoCommand);

    expect(undoResult._unsafeUnwrap().entry).toBe(entry);
    expect(redoResult._unsafeUnwrap().entry).toBe(entry);
    expect(service.undoCalls).toHaveLength(1);
    expect(service.undoCalls[0]?.tableId).toBe(tableId);
    expect(service.undoCalls[0]?.windowId).toBe('window-2');
    expect(service.undoCalls[0]?.context.actorId).toBe(context.actorId);
    expect(service.undoCalls[0]?.context.windowId).toBe(context.windowId);
    expect(service.undoCalls[0]?.context.requestId).toBe(context.requestId);
    expect(service.redoCalls).toHaveLength(1);
    expect(service.redoCalls[0]?.tableId).toBe(tableId);
    expect(service.redoCalls[0]?.windowId).toBeUndefined();
    expect(service.redoCalls[0]?.context.actorId).toBe(context.actorId);
    expect(service.redoCalls[0]?.context.windowId).toBe(context.windowId);
    expect(service.redoCalls[0]?.context.requestId).toBe(context.requestId);
  });

  it('routes field snapshot replay commands through the replay service', async () => {
    const context = buildContext();
    const table = buildTable();
    const replayService = new FakeFieldUndoRedoReplayService(table);
    const baseId = table.baseId().toString();
    const tableId = table.id().toString();
    const fieldId = table.getFields()[0]!.id().toString();
    const snapshot = {
      field: {
        id: fieldId,
        name: 'Title',
        type: 'singleLineText' as const,
      },
      views: [],
    };

    const applyHandler = new ApplyFieldSnapshotHandler(
      replayService as unknown as FieldUndoRedoReplayService
    );
    const replayHandler = new ReplayFieldTypeConversionHandler(
      replayService as unknown as FieldUndoRedoReplayService
    );

    const applyCommand = ApplyFieldSnapshotCommand.create({
      baseId,
      tableId,
      snapshot,
    })._unsafeUnwrap();
    const replayCommand = ReplayFieldTypeConversionCommand.create({
      baseId,
      tableId,
      snapshot: {
        ...snapshot,
        records: [{ recordId: `rec${'e'.repeat(16)}`, value: 'restored' }],
      },
    })._unsafeUnwrap();

    const applyResult = await applyHandler.handle(context, applyCommand);
    const replayResult = await replayHandler.handle(context, replayCommand);

    expect(applyResult._unsafeUnwrap().table).toBe(table);
    expect(replayResult._unsafeUnwrap().table).toBe(table);
    expect(replayService.calls).toHaveLength(2);
    expect(replayService.calls[0]?.params).toEqual({ baseId, tableId, snapshot });
    expect(replayService.calls[1]?.params.snapshot.records).toEqual([
      { recordId: `rec${'e'.repeat(16)}`, value: 'restored' },
    ]);
  });

  it('validates field snapshot replay input before handler execution', () => {
    const invalidSnapshot = ApplyFieldSnapshotCommand.create({
      baseId: `bse${'f'.repeat(16)}`,
      tableId: `tbl${'f'.repeat(16)}`,
      snapshot: {
        field: {
          id: `fld${'g'.repeat(16)}`,
          name: 'Broken',
          type: 'singleLineText',
        },
        views: [{}],
      },
    });

    expect(invalidSnapshot.isErr()).toBe(true);
    expect(invalidSnapshot._unsafeUnwrapErr().message).toContain('Invalid');
  });
});
