import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { UpdateRecordCommand } from '../../commands/UpdateRecordCommand';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import { RecordId } from '../../domain/table/records/RecordId';
import { TableId } from '../../domain/table/TableId';
import type { ICommandBus } from '../../ports/CommandBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { MemoryUndoRedoStore } from '../../ports/memory/MemoryUndoRedoStore';
import type { UndoEntry, UndoScope } from '../../ports/UndoRedoStore';

import { UndoRedoService } from './UndoRedoService';

class FakeCommandBus implements ICommandBus {
  lastContext: IExecutionContext | undefined;
  lastCommand: unknown;

  async execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>> {
    this.lastContext = context;
    this.lastCommand = command;
    return ok(undefined as TResult);
  }
}

const buildContext = (): IExecutionContext => ({
  actorId: ActorId.create('actor')._unsafeUnwrap(),
  windowId: 'window-1',
  requestId: 'req-1',
});

const buildScope = (context: IExecutionContext, tableId: TableId): UndoScope => ({
  actorId: context.actorId,
  tableId,
  windowId: context.windowId ?? 'window-1',
});

const buildRecordIds = () => ({
  tableId: TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap(),
  recordId: RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap(),
});

describe('UndoRedoService', () => {
  it('records update entries and skips when in undo/redo mode', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.recordUpdateRecord(context, {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const entries = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as UndoEntry;
    expect(entry.undoCommand.type).toBe('UpdateRecord');
    if (entry.undoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord undo command');
    }
    if (entry.redoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord redo command');
    }
    expect(entry.undoCommand.payload.fields).toEqual({ fld1: 'old' });
    expect(entry.redoCommand.payload.fields).toEqual({ fld1: 'new' });
    expect(entry.requestId).toBe('req-1');

    await service.recordUpdateRecord(
      { ...context, undoRedo: { mode: 'undo' } },
      {
        tableId,
        recordId,
        oldValues: { fld1: 'x' },
        newValues: { fld1: 'y' },
        recordVersionBefore: 2,
        recordVersionAfter: 3,
      }
    );

    const entriesAfterSkip = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    expect(entriesAfterSkip).toHaveLength(1);
  });

  it('executes undo/redo via command bus with context mode', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.recordUpdateRecord(context, {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const undoResult = await service.undo(context, tableId, context.windowId);
    const undoEntry = undoResult._unsafeUnwrap();
    if (undoEntry?.undoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord undo command');
    }
    expect(undoEntry.undoCommand.payload.recordId).toBe(recordId.toString());
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const undoCommand = bus.lastCommand as UpdateRecordCommand;
    expect(undoCommand.tableId.toString()).toBe(tableId.toString());
    expect(undoCommand.recordId.toString()).toBe(recordId.toString());
    expect(undoCommand.fieldValues.get('fld1')).toBe('old');

    const redoResult = await service.redo(context, tableId, context.windowId);
    const redoEntry = redoResult._unsafeUnwrap();
    if (redoEntry?.redoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord redo command');
    }
    expect(redoEntry.redoCommand.payload.recordId).toBe(recordId.toString());
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
    const redoCommand = bus.lastCommand as UpdateRecordCommand;
    expect(redoCommand.fieldValues.get('fld1')).toBe('new');
  });
});
