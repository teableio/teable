import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { ApplyFieldSnapshotCommand } from '../../commands/ApplyFieldSnapshotCommand';
import type { ApplyRecordOrdersCommand } from '../../commands/ApplyRecordOrdersCommand';
import type { ApplyViewSnapshotCommand } from '../../commands/ApplyViewSnapshotCommand';
import type { DeleteFieldCommand } from '../../commands/DeleteFieldCommand';
import type { DeleteRecordsCommand } from '../../commands/DeleteRecordsCommand';
import type { DeleteViewCommand } from '../../commands/DeleteViewCommand';
import type { DisableViewShareCommand } from '../../commands/DisableViewShareCommand';
import type { EnableViewShareCommand } from '../../commands/EnableViewShareCommand';
import type { ReplayFieldTypeConversionCommand } from '../../commands/ReplayFieldTypeConversionCommand';
import type { RestoreRecordsCommand } from '../../commands/RestoreRecordsCommand';
import type { SetButtonValueCommand } from '../../commands/SetButtonValueCommand';
import type { UpdateRecordCommand } from '../../commands/UpdateRecordCommand';
import type { UpdateRecordsCommand } from '../../commands/UpdateRecordsCommand';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { RecordId } from '../../domain/table/records/RecordId';
import { TableId } from '../../domain/table/TableId';
import type { ICommandBus } from '../../ports/CommandBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { MemoryUndoRedoStore } from '../../ports/memory/MemoryUndoRedoStore';
import type { ISpan, ITracer, SpanAttributes } from '../../ports/Tracer';
import { TeableSpanAttributes } from '../../ports/Tracer';
import { createUndoRedoCommand, type UndoEntry, type UndoScope } from '../../ports/UndoRedoStore';

import {
  toUndoRedoStackAppendContext,
  toUndoRedoStackReplayContext,
  UndoRedoStackService,
} from './UndoRedoStackService';

class FakeCommandBus implements ICommandBus {
  readonly contexts: IExecutionContext[] = [];
  readonly commands: unknown[] = [];
  lastContext: IExecutionContext | undefined;
  lastCommand: unknown;
  failWith: DomainError | undefined;
  failAfterRemaining: number | undefined;
  beforeExecute?: () => Promise<void>;

  async execute<TCommand, TResult>(
    context: IExecutionContext,
    command: TCommand
  ): Promise<Result<TResult, DomainError>> {
    this.contexts.push(context);
    this.commands.push(command);
    this.lastContext = context;
    this.lastCommand = command;
    if (this.beforeExecute) {
      await this.beforeExecute();
    }
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = undefined;
      return err(error);
    }
    if (this.failAfterRemaining !== undefined) {
      this.failAfterRemaining -= 1;
      if (this.failAfterRemaining === 0) {
        this.failAfterRemaining = undefined;
        return err(domainError.unexpected({ message: 'replay failed' }));
      }
    }
    return ok(undefined as TResult);
  }
}

class FlakyCommitStore extends MemoryUndoRedoStore {
  constructor(public commitFailuresLeft = 0) {
    super();
  }

  override async commit(scope: UndoScope, token: string) {
    if (this.commitFailuresLeft > 0) {
      this.commitFailuresLeft -= 1;
      return err(domainError.unexpected({ message: 'commit failed' }));
    }
    return super.commit(scope, token);
  }
}

class FlakyMarkSucceededStore extends MemoryUndoRedoStore {
  failMarkSucceeded = false;

  override async markSucceeded(scope: UndoScope, token: string) {
    if (this.failMarkSucceeded) {
      this.failMarkSucceeded = false;
      return err(domainError.unexpected({ message: 'markSucceeded failed' }));
    }
    return super.markSucceeded(scope, token);
  }
}

class FakeSpan implements ISpan {
  readonly errors: string[] = [];
  ended = false;

  constructor(
    readonly name: string,
    readonly attributes?: SpanAttributes
  ) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.setAttributes({ [key]: value });
  }

  setAttributes(attributes: SpanAttributes): void {
    if (!this.attributes) {
      return;
    }
    Object.assign(this.attributes as Record<string, string | number | boolean>, attributes);
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  readonly spans: Array<{ name: string; attributes?: SpanAttributes; span: FakeSpan }> = [];
  private readonly activeSpans: FakeSpan[] = [];

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan(name, attributes ? { ...attributes } : undefined);
    this.spans.push({ name, attributes: span.attributes, span });
    return span;
  }

  async withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T> {
    this.activeSpans.push(span as FakeSpan);
    try {
      return await callback();
    } finally {
      this.activeSpans.pop();
    }
  }

  getActiveSpan(): ISpan | undefined {
    return this.activeSpans[this.activeSpans.length - 1];
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

describe('UndoRedoStackService', () => {
  it('normalizes undefined update values to null in stored undo commands', async () => {
    const command = createUndoRedoCommand('UpdateRecord', {
      tableId: `tbl${'z'.repeat(16)}`,
      recordId: `rec${'y'.repeat(16)}`,
      fields: { fld1: undefined, fld2: 'value' },
      fieldKeyType: 'id',
      typecast: false,
    });

    if (command.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord command');
    }

    expect(command.payload.fields).toEqual({ fld1: null, fld2: 'value' });
  });

  it('normalizes undefined bulk update values to null in stored undo commands', async () => {
    const command = createUndoRedoCommand('UpdateRecords', {
      tableId: `tbl${'z'.repeat(16)}`,
      records: [
        {
          id: `rec${'y'.repeat(16)}`,
          fields: { fld1: undefined, fld2: 'value' },
        },
      ],
      fieldKeyType: 'id',
      typecast: false,
    });

    expect(command.payload.records[0]?.fields).toEqual({ fld1: null, fld2: 'value' });
  });

  it('records update entries and skips when in undo/redo mode', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
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

    await service.appendRecordUpdate(
      toUndoRedoStackAppendContext({ ...context, undoRedo: { mode: 'undo' } }),
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
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const undoResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(undoResult._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    expect(bus.lastContext?.undoRedo?.operationId).toEqual(expect.any(String));
    const undoCommand = bus.lastCommand as UpdateRecordCommand;
    expect(undoCommand.tableId.toString()).toBe(tableId.toString());
    expect(undoCommand.recordId.toString()).toBe(recordId.toString());
    expect(undoCommand.fieldValues.get('fld1')).toBe('old');

    const redoResult = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redoResult._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
    expect(bus.lastContext?.undoRedo?.operationId).toEqual(expect.any(String));
    const redoCommand = bus.lastCommand as UpdateRecordCommand;
    expect(redoCommand.fieldValues.get('fld1')).toBe('new');
  });

  it('wraps record updates with schema side-effect commands when provided', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const fieldId = `fld${'h'.repeat(16)}`;

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
      undoCommandsAfter: [
        createUndoRedoCommand('ApplyFieldSnapshot', {
          baseId: `bse${'i'.repeat(16)}`,
          tableId: tableId.toString(),
          snapshot: {
            field: { id: fieldId, name: 'Status', type: 'singleSelect', options: { choices: [] } },
            views: [],
          },
        }),
      ],
      redoCommandsBefore: [
        createUndoRedoCommand('ApplyFieldSnapshot', {
          baseId: `bse${'i'.repeat(16)}`,
          tableId: tableId.toString(),
          snapshot: {
            field: { id: fieldId, name: 'Status', type: 'singleSelect', options: { choices: [] } },
            views: [],
          },
        }),
      ],
    });

    const entries = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    const entry = entries[0] as UndoEntry;
    expect(entry.undoCommand.type).toBe('Batch');
    expect(entry.redoCommand.type).toBe('Batch');
  });

  it('builds update undo/redo commands directly from repository snapshots', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdateFromSnapshot(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      fieldIds: ['fld1', 'fld2'],
      snapshot: {
        previous: {
          recordId: recordId.toString(),
          fields: { fld1: 'before', fld2: undefined },
        },
        current: {
          recordId: recordId.toString(),
          fields: { fld1: 'after', fld2: null },
        },
        oldVersion: 3,
        newVersion: 4,
      },
    });

    const entries = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as UndoEntry;
    if (entry.undoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord undo command');
    }
    if (entry.redoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord redo command');
    }
    expect(entry.undoCommand.payload.fields).toEqual({ fld1: 'before', fld2: null });
    expect(entry.redoCommand.payload.fields).toEqual({ fld1: 'after', fld2: null });
    expect(entry.recordVersionBefore).toBe(3);
    expect(entry.recordVersionAfter).toBe(4);
  });

  it('replays Button snapshots with the aggregate-only Button command', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const fieldId = `fld${'c'.repeat(16)}`;

    await service.appendButtonValueUpdateFromSnapshot(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      fieldId,
      snapshot: {
        previous: {
          recordId: recordId.toString(),
          fields: {},
        },
        current: {
          recordId: recordId.toString(),
          fields: { [fieldId]: { count: 1 } },
        },
        oldVersion: 7,
        newVersion: 8,
      },
    });

    const entries = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.undoCommand).toMatchObject({
      type: 'SetButtonValue',
      payload: { fieldId, value: null },
    });
    expect(entries[0]?.redoCommand).toMatchObject({
      type: 'SetButtonValue',
      payload: { fieldId, value: { count: 1 } },
    });

    await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId);
    const undoCommand = bus.lastCommand as SetButtonValueCommand;
    expect(undoCommand.fieldId.toString()).toBe(fieldId);
    expect(undoCommand.value).toBeNull();
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');

    await service.applyRedo(toUndoRedoStackReplayContext(context), tableId, context.windowId);
    const redoCommand = bus.lastCommand as SetButtonValueCommand;
    expect(redoCommand.value).toEqual({ count: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
  });

  it('executes apply-record-orders undo entries via the command bus', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('ApplyRecordOrders', {
        tableId: tableId.toString(),
        viewId: `viw${'c'.repeat(16)}`,
        records: [{ recordId: `rec${'d'.repeat(16)}`, order: 1 }],
      }),
      redoCommand: createUndoRedoCommand('ApplyRecordOrders', {
        tableId: tableId.toString(),
        viewId: `viw${'c'.repeat(16)}`,
        records: [{ recordId: `rec${'d'.repeat(16)}`, order: 2 }],
      }),
    });

    const undoResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(undoResult._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const applied = bus.lastCommand as ApplyRecordOrdersCommand;
    expect(applied.tableId.toString()).toBe(tableId.toString());
    expect(applied.records[0]?.order).toBe(1);
  });

  it('executes field snapshot replay and delete-field undo entries via the command bus', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const baseId = `bse${'f'.repeat(16)}`;
    const fieldId = `fld${'g'.repeat(16)}`;

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('DeleteField', {
        baseId,
        tableId: tableId.toString(),
        fieldId,
      }),
      redoCommand: createUndoRedoCommand('ApplyFieldSnapshot', {
        baseId,
        tableId: tableId.toString(),
        snapshot: {
          field: {
            id: fieldId,
            name: 'Undo Field',
            type: 'singleLineText',
          },
          views: [],
        },
      }),
    });

    const undoResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(undoResult._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const deleteFieldCommand = bus.lastCommand as DeleteFieldCommand;
    expect(deleteFieldCommand.fieldId.toString()).toBe(fieldId);

    const redoResult = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redoResult._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
    const applyFieldSnapshotCommand = bus.lastCommand as ApplyFieldSnapshotCommand;
    expect(applyFieldSnapshotCommand.snapshot.field.id).toBe(fieldId);
  });

  it('executes View snapshot replay and delete through v2 commands', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const viewId = `viw${'v'.repeat(16)}`;
    const snapshot = {
      id: viewId,
      name: 'Planning',
      type: 'grid' as const,
      order: 2,
      properties: {
        description: 'Restored by v2',
        isLocked: true,
      },
      columnMeta: {
        [`fld${'f'.repeat(16)}`]: { order: 0, width: 320 },
      },
      query: {},
      options: { rowHeight: 'tall' },
    };

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('ApplyViewSnapshot', {
        tableId: tableId.toString(),
        snapshot,
      }),
      redoCommand: createUndoRedoCommand('DeleteView', {
        tableId: tableId.toString(),
        viewId,
      }),
    });

    await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId);
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const applyViewSnapshotCommand = bus.lastCommand as ApplyViewSnapshotCommand;
    expect(applyViewSnapshotCommand.snapshot).toEqual(snapshot);

    await service.applyRedo(toUndoRedoStackReplayContext(context), tableId, context.windowId);
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
    const deleteViewCommand = bus.lastCommand as DeleteViewCommand;
    expect(deleteViewCommand.viewId.toString()).toBe(viewId);
  });

  it('replays View share lifecycle commands without carrying share credentials', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const viewId = `viw${'s'.repeat(16)}`;

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('EnableViewShare', {
        tableId: tableId.toString(),
        viewId,
      }),
      redoCommand: createUndoRedoCommand('DisableViewShare', {
        tableId: tableId.toString(),
        viewId,
      }),
    });

    await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId);
    const enableCommand = bus.lastCommand as EnableViewShareCommand;
    expect(enableCommand.viewId.toString()).toBe(viewId);
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');

    await service.applyRedo(toUndoRedoStackReplayContext(context), tableId, context.windowId);
    const disableCommand = bus.lastCommand as DisableViewShareCommand;
    expect(disableCommand.viewId.toString()).toBe(viewId);
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
  });

  it('executes field type conversion replay via the command bus', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const baseId = `bse${'j'.repeat(16)}`;
    const fieldId = `fld${'k'.repeat(16)}`;

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('ReplayFieldTypeConversion', {
        baseId,
        tableId: tableId.toString(),
        snapshot: {
          field: {
            id: fieldId,
            name: 'Score',
            type: 'number',
          },
          views: [],
          records: [{ recordId: `rec${'l'.repeat(16)}`, value: 42 }],
        },
      }),
      redoCommand: createUndoRedoCommand('ApplyFieldSnapshot', {
        baseId,
        tableId: tableId.toString(),
        snapshot: {
          field: {
            id: fieldId,
            name: 'Score',
            type: 'singleLineText',
          },
          views: [],
        },
      }),
    });

    const undoResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(undoResult._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const replayCommand = bus.lastCommand as ReplayFieldTypeConversionCommand;
    expect(replayCommand.snapshot.field.id).toBe(fieldId);
  });

  it('emits trace spans for undo/redo store access and replay execution', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const tracer = new FakeTracer();
    const context: IExecutionContext = { ...buildContext(), tracer };
    const { tableId, recordId } = buildRecordIds();

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('UpdateRecord', {
        tableId: tableId.toString(),
        recordId: recordId.toString(),
        fields: { fld1: 'old' },
        fieldKeyType: 'id',
        typecast: false,
      }),
      redoCommand: createUndoRedoCommand('UpdateRecord', {
        tableId: tableId.toString(),
        recordId: recordId.toString(),
        fields: { fld1: 'new' },
        fieldKeyType: 'id',
        typecast: false,
      }),
    });

    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'teable.UndoRedoStackService.appendEntry',
        'teable.UndoRedoStackService.storeAppend',
      ])
    );
    const appendSpan = tracer.spans.find(
      (span) => span.name === 'teable.UndoRedoStackService.storeAppend'
    );
    expect(appendSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.undo_redo.undo_command_type': 'UpdateRecord',
      'teable.undo_redo.redo_command_type': 'UpdateRecord',
    });

    tracer.spans.length = 0;

    const undoResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    undoResult._unsafeUnwrap();

    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'teable.UndoRedoStackService.applyUndo',
        'teable.UndoRedoStackService.storeUndo',
        'teable.UndoRedoStackService.executeCommandData',
      ])
    );
    const executeSpan = tracer.spans.find(
      (span) => span.name === 'teable.UndoRedoStackService.executeCommandData'
    );
    expect(executeSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.VERSION]: 'v2',
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.undo_redo.command_type': 'UpdateRecord',
      'teable.undo_redo.mode': 'undo',
    });
  });

  it('supports multi-step undo/redo stacks and clears redo history after a fresh change', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'v0' },
      newValues: { fld1: 'v1' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'v1' },
      newValues: { fld1: 'v2' },
      recordVersionBefore: 2,
      recordVersionAfter: 3,
    });

    const firstUndo = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(firstUndo._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect((bus.lastCommand as UpdateRecordCommand).fieldValues.get('fld1')).toBe('v1');

    const secondUndo = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(secondUndo._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect((bus.lastCommand as UpdateRecordCommand).fieldValues.get('fld1')).toBe('v0');

    const redo = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redo._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect((bus.lastCommand as UpdateRecordCommand).fieldValues.get('fld1')).toBe('v1');

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'v1' },
      newValues: { fld1: 'v3' },
      recordVersionBefore: 2,
      recordVersionAfter: 4,
    });

    const redoAfterFreshChange = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redoAfterFreshChange._unsafeUnwrap()).toBeNull();
  });

  it('compacts batch update records and preserves surrounding command order', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const secondRecordId = RecordId.create(`rec${'q'.repeat(16)}`)._unsafeUnwrap();

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('Batch', [
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: recordId.toString(),
          fields: { fld1: 'before-title' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: secondRecordId.toString(),
          fields: { fld1: 'before-second-title' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        createUndoRedoCommand('ApplyRecordOrders', {
          tableId: tableId.toString(),
          viewId: `viw${'m'.repeat(16)}`,
          records: [{ recordId: recordId.toString(), order: 3 }],
        }),
      ]),
      redoCommand: createUndoRedoCommand('Batch', [
        createUndoRedoCommand('ApplyRecordOrders', {
          tableId: tableId.toString(),
          viewId: `viw${'m'.repeat(16)}`,
          records: [{ recordId: recordId.toString(), order: 4 }],
        }),
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: recordId.toString(),
          fields: { fld1: 'after-title' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: secondRecordId.toString(),
          fields: { fld1: 'after-second-title' },
          fieldKeyType: 'id',
          typecast: false,
        }),
      ]),
    });

    const undoResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(undoResult.isOk()).toBe(true);
    expect(bus.commands).toHaveLength(2);
    const undoBulkCommand = bus.commands[0] as UpdateRecordsCommand;
    expect(undoBulkCommand.records?.map((record) => record.recordId.toString())).toEqual([
      recordId.toString(),
      secondRecordId.toString(),
    ]);
    expect(undoBulkCommand.records?.[0]?.fieldValues.get('fld1')).toBe('before-title');
    expect(undoBulkCommand.records?.[1]?.fieldValues.get('fld1')).toBe('before-second-title');
    expect((bus.commands[1] as ApplyRecordOrdersCommand).records[0]?.order).toBe(3);
    expect(bus.contexts.every((candidate) => candidate.undoRedo?.mode === 'undo')).toBe(true);

    bus.commands.length = 0;
    bus.contexts.length = 0;

    const redoResult = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redoResult.isOk()).toBe(true);
    expect(bus.commands).toHaveLength(2);
    expect((bus.commands[0] as ApplyRecordOrdersCommand).records[0]?.order).toBe(4);
    const redoBulkCommand = bus.commands[1] as UpdateRecordsCommand;
    expect(redoBulkCommand.records?.map((record) => record.recordId.toString())).toEqual([
      recordId.toString(),
      secondRecordId.toString(),
    ]);
    expect(redoBulkCommand.records?.[0]?.fieldValues.get('fld1')).toBe('after-title');
    expect(redoBulkCommand.records?.[1]?.fieldValues.get('fld1')).toBe('after-second-title');
    expect(bus.contexts.every((candidate) => candidate.undoRedo?.mode === 'redo')).toBe(true);
  });

  it('reports replay progress using compacted command unit counts', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const secondRecordId = RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap();
    const progress: unknown[] = [];

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('Batch', [
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: recordId.toString(),
          fields: { fld1: 'before-title' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: secondRecordId.toString(),
          fields: { fld1: 'before-second-title' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        createUndoRedoCommand('DeleteRecords', {
          tableId: tableId.toString(),
          recordIds: [recordId.toString()],
        }),
      ]),
      redoCommand: createUndoRedoCommand('Batch', []),
    });

    const result = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      {
        onProgress: (event) => progress.push(event),
      }
    );

    expect(result.isOk()).toBe(true);
    expect(progress).toEqual([
      { phase: 'preparing', totalCount: 3, processedCount: 0 },
      {
        phase: 'replaying',
        totalCount: 3,
        processedCount: 2,
        commandType: 'UpdateRecords',
        commandCount: 2,
      },
      {
        phase: 'replaying',
        totalCount: 3,
        processedCount: 3,
        commandType: 'DeleteRecords',
        commandCount: 1,
      },
    ]);
  });

  it('skips storing empty batch entries and requires a window id for undo/redo', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('Batch', []),
      redoCommand: createUndoRedoCommand('Batch', []),
    });

    const entries = await store.list(buildScope(context, tableId));
    expect(entries._unsafeUnwrap()).toHaveLength(0);

    const missingWindowResult = await service.applyUndo(
      toUndoRedoStackReplayContext({ ...context, windowId: undefined }),
      tableId
    );
    expect(missingWindowResult.isErr()).toBe(true);
    expect(missingWindowResult._unsafeUnwrapErr().message).toContain('Missing windowId');
  });

  it('rejects unsupported undo/redo command versions before execution', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    const scope = buildScope(context, tableId);
    const invalidEntry: Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId' | 'groupId'> = {
      undoCommand: {
        ...createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: recordId.toString(),
          fields: { fld1: 'old' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        version: 999,
      },
      redoCommand: createUndoRedoCommand('UpdateRecord', {
        tableId: tableId.toString(),
        recordId: recordId.toString(),
        fields: { fld1: 'new' },
        fieldKeyType: 'id',
        typecast: false,
      }),
    };

    const appended = await service.appendEntry(
      toUndoRedoStackAppendContext(context),
      tableId,
      invalidEntry
    );
    expect(appended.isOk()).toBe(true);
    expect(bus.commands).toHaveLength(0);
    const history = (await store.list(scope))._unsafeUnwrap();
    expect(history).toHaveLength(1);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await service.applyUndo(
        toUndoRedoStackReplayContext(context),
        tableId,
        context.windowId
      );
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Unsupported undo/redo command version');
      expect(bus.commands).toHaveLength(0);
      expect((await store.list(scope))._unsafeUnwrap()).toEqual(history);

      const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
      expect(reservation.executedLeafIndex).toBe(0);
      expect((await store.readReservedEntry(scope, reservation.token, 0))._unsafeUnwrap()).toEqual(
        history[0]
      );
      (await store.abort(scope, reservation.token))._unsafeUnwrap();
      expect((await store.reserve(scope, 'redo'))._unsafeUnwrap()).toBeNull();
    }
  });

  it('keeps the stack entry undoable when command replay fails', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    bus.failWith = domainError.unexpected({ message: 'replay failed' });
    const failed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().message).toBe('replay failed');
    expect(bus.commands).toHaveLength(1);

    const retried = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(retried.isOk()).toBe(true);
    expect(retried._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.commands).toHaveLength(2);
    const retriedCommand = bus.lastCommand as UpdateRecordCommand;
    expect(retriedCommand.fieldValues.get('fld1')).toBe('old');
  });

  it('does not commit a batch entry when a later command fails', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const otherRecordId = RecordId.create(`rec${'c'.repeat(16)}`)._unsafeUnwrap();

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
      undoCommand: createUndoRedoCommand('Batch', [
        createUndoRedoCommand('UpdateRecord', {
          tableId: tableId.toString(),
          recordId: recordId.toString(),
          fields: { fld1: 'old' },
          fieldKeyType: 'id',
          typecast: false,
        }),
        createUndoRedoCommand('DeleteRecords', {
          tableId: tableId.toString(),
          recordIds: [otherRecordId.toString()],
        }),
      ]),
      redoCommand: createUndoRedoCommand('Batch', []),
    });

    bus.failAfterRemaining = 2;
    const failed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().message).toBe('replay failed');
    expect(bus.commands).toHaveLength(2);

    const retried = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(retried.isOk()).toBe(true);
    expect(retried._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.commands).toHaveLength(3);
  });

  it('rejects a second concurrent undo instead of replaying the same entry twice', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const [first, second] = await Promise.all([
      service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId),
      service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((result) => result.isOk() && result._unsafeUnwrap() !== null);
    const conflicts = outcomes.filter((result) => result.isErr());
    expect(succeeded).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');
    expect(bus.commands).toHaveLength(1);
  });

  it('retries cursor commit after a failed commit without replaying the command', async () => {
    const store = new FlakyCommitStore(1);
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const result = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.commands).toHaveLength(1);

    const redo = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redo.isOk()).toBe(true);
    expect(bus.commands).toHaveLength(2);
  });

  it('does not replay a command when retrying after commit exhausted retries', async () => {
    const store = new FlakyCommitStore(10);
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const failed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(failed.isErr()).toBe(true);
    expect(failed._unsafeUnwrapErr().message).toBe('commit failed');
    expect(bus.commands).toHaveLength(1);

    store.commitFailuresLeft = 0;
    const retried = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(retried.isOk()).toBe(true);
    expect(retried._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.commands).toHaveLength(1);
  });

  it('checkpoints each replayed leaf so the group cannot be taken over at the original expiry', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 15_000 });
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus, {
      restorePurgeGuard: false,
      reservationRenewIntervalMs: 0,
    });
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const scope = buildScope(context, tableId);
    const chunks = ['c', 'd'].map((letter) => [
      { recordId: `rec${letter.repeat(16)}`, fields: { fld1: letter }, version: 1 },
    ]);
    for (const deletedRecords of chunks) {
      (
        await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
          tableId,
          groupId: 'checkpoint-group',
          groupPosition: deletedRecords === chunks[0] ? 'start' : 'continue',
          deletedRecords,
        })
      )._unsafeUnwrap();
    }

    bus.beforeExecute = async () => {
      if (bus.commands.length === 1) {
        now = 15_999;
        return;
      }
      now = 16_001;
      const competing = await store.reserve(scope, 'undo');
      expect(competing._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');
    };

    const result = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(result._unsafeUnwrap()).toEqual({ entryCount: 2 });
    expect(bus.commands.map((command) => (command as RestoreRecordsCommand).records)).toEqual([
      chunks[1],
      chunks[0],
    ]);
    expect(
      (
        await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId)
      )._unsafeUnwrap()
    ).toBeNull();
    const redo = (await store.reserve(scope, 'redo'))._unsafeUnwrap()!;
    expect(redo.entryCount).toBe(2);
    (await store.abort(scope, redo.token))._unsafeUnwrap();
  });

  it('stops replay on a checkpoint failure without consuming the cursor', async () => {
    class FailingCheckpointStore extends MemoryUndoRedoStore {
      override async markProgress(_scope: UndoScope, _token: string, _executedLeafIndex: number) {
        return err(domainError.unexpected({ message: 'checkpoint failed' }));
      }
    }

    const store = new FailingCheckpointStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus, {
      restorePurgeGuard: false,
      reservationRenewIntervalMs: 0,
    });
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const scope = buildScope(context, tableId);
    for (const letter of ['e', 'f']) {
      (
        await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
          tableId,
          groupId: 'failed-checkpoint-group',
          groupPosition: letter === 'e' ? 'start' : 'continue',
          deletedRecords: [
            { recordId: `rec${letter.repeat(16)}`, fields: { fld1: letter }, version: 1 },
          ],
        })
      )._unsafeUnwrap();
    }

    const result = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(result._unsafeUnwrapErr().message).toBe('checkpoint failed');
    expect(
      bus.commands.map((command) => (command as RestoreRecordsCommand).records[0]?.fields.fld1)
    ).toEqual(['f']);
    expect((await store.reserve(scope, 'redo'))._unsafeUnwrap()).toBeNull();
    const pending = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(pending.entryCount).toBe(2);
    expect(pending.executedLeafIndex).toBe(0);
    (await store.abort(scope, pending.token))._unsafeUnwrap();
  });

  it('does not re-execute when markSucceeded fails after the command already ran', async () => {
    const store = new FlakyMarkSucceededStore();
    store.failMarkSucceeded = true;
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const failed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(failed.isErr()).toBe(true);
    expect(bus.commands).toHaveLength(1);

    const retried = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(retried.isOk()).toBe(true);
    expect(bus.commands).toHaveLength(1);
  });

  it('keeps a long-running replay from being taken over', async () => {
    const store = new MemoryUndoRedoStore({ leaseMs: 40 });
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus, {
      restorePurgeGuard: false,
      reservationRenewIntervalMs: 15,
    });
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    bus.beforeExecute = async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 80);
      await promise;
      const concurrent = await service.applyUndo(
        toUndoRedoStackReplayContext(context),
        tableId,
        context.windowId
      );
      expect(concurrent.isErr()).toBe(true);
      expect(concurrent._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');
    };

    const result = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(result.isOk()).toBe(true);
    expect(bus.commands).toHaveLength(1);
  });

  it('lets the host veto the reserved entry before replay and keeps it on the stack', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();

    await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
      tableId,
      recordId,
      oldValues: { fld1: 'old' },
      newValues: { fld1: 'new' },
      recordVersionBefore: 1,
      recordVersionAfter: 2,
    });

    const [storedEntry] = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    const seen: Array<{ type: string; mode: string }> = [];
    const vetoed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      {
        beforeReplay: async (entry, mode) => {
          expect(entry).toEqual(storedEntry);
          expect(entry.requestId).toBe(context.requestId);
          seen.push({ type: entry.undoCommand.type, mode });
          return err(domainError.forbidden({ message: 'no longer allowed' }));
        },
      }
    );
    expect(vetoed.isErr()).toBe(true);
    expect(vetoed._unsafeUnwrapErr().message).toBe('no longer allowed');
    expect(seen).toEqual([{ type: 'UpdateRecord', mode: 'undo' }]);
    expect(bus.commands).toHaveLength(0);

    // The veto aborted the reservation: the same entry replays once allowed.
    const allowed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      { beforeReplay: async () => ok(undefined) }
    );
    expect(allowed.isOk()).toBe(true);
    expect(allowed._unsafeUnwrap()).toEqual({ entryCount: 1 });
    expect(bus.commands).toHaveLength(1);
  });

  it('lets the host veto a later grouped entry before any entry is replayed', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const scope = buildScope(context, tableId);
    for (const letter of ['m', 'n']) {
      (
        await service.appendRecordDelete(
          toUndoRedoStackAppendContext({ ...context, requestId: `req-${letter}` }),
          {
            tableId,
            groupId: 'veto-group',
            groupPosition: letter === 'm' ? 'start' : 'continue',
            deletedRecords: [{ recordId: `rec${letter.repeat(16)}`, fields: { fld1: letter } }],
          }
        )
      )._unsafeUnwrap();
    }
    const history = (await store.list(scope))._unsafeUnwrap();
    const entries = [...history].reverse();
    const seen: UndoEntry[] = [];
    const vetoed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      {
        beforeReplay: async (entry, mode) => {
          expect(mode).toBe('undo');
          expect(bus.commands).toHaveLength(0);
          expect(entry).toEqual(entries[seen.length]);
          seen.push(entry);
          return entry.requestId === 'req-m'
            ? err(domainError.forbidden({ message: 'older chunk no longer allowed' }))
            : ok(undefined);
        },
      }
    );
    expect(vetoed._unsafeUnwrapErr().message).toBe('older chunk no longer allowed');
    expect(seen).toEqual(entries);
    expect(seen.map((entry) => entry.requestId)).toEqual(['req-n', 'req-m']);
    expect(bus.commands).toHaveLength(0);
    expect((await store.list(scope))._unsafeUnwrap()).toEqual(history);

    const allowed = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      { beforeReplay: async () => ok(undefined) }
    );
    expect(allowed._unsafeUnwrap()).toEqual({ entryCount: 2 });
    expect(
      bus.commands.map((command) => (command as RestoreRecordsCommand).records[0]?.fields.fld1)
    ).toEqual(['n', 'm']);
  });

  it('restores grouped delete chunks exactly and redoes in original order despite interleaved actions', async () => {
    class LazyOnlyStore extends MemoryUndoRedoStore {
      override async list() {
        return err(domainError.unexpected({ message: 'Replay must not load the history window' }));
      }
    }
    const store = new LazyOnlyStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const snapshots = ['c', 'd', 'e'].map((letter, index) => ({
      recordId: `rec${letter.repeat(16)}`,
      fields: { text: `exact-${letter}`, empty: null, nested: [letter, { n: index }] },
      version: index + 2,
      orders: { [`viw${'f'.repeat(16)}`]: 0.125 + index },
      autoNumber: index + 10,
      createdTime: '2026-01-01T00:00:00.000Z',
      createdBy: 'actor-original',
      lastModifiedTime: '2026-02-01T00:00:00.000Z',
      lastModifiedBy: 'actor-editor',
    }));
    const chunks = [snapshots.slice(0, 2), snapshots.slice(2)];
    (
      await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
        tableId,
        groupId: 'delete-interaction',
        groupPosition: 'start',
        deletedRecords: chunks[0]!,
      })
    )._unsafeUnwrap();
    (
      await service.appendRecordUpdate(toUndoRedoStackAppendContext(context), {
        tableId,
        recordId,
        oldValues: { fld1: 'independent-old' },
        newValues: { fld1: 'independent-new' },
        recordVersionBefore: 1,
        recordVersionAfter: 2,
      })
    )._unsafeUnwrap();
    (
      await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
        tableId,
        groupId: 'delete-interaction',
        groupPosition: 'continue',
        deletedRecords: chunks[1]!,
      })
    )._unsafeUnwrap();
    const observed: string[] = [];
    const undo = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      {
        onEntryReplayed: async (entry) => {
          observed.push(entry.groupId!);
        },
      }
    );
    expect(undo._unsafeUnwrap()).toEqual({ entryCount: 2 });
    expect(bus.commands.map((command) => (command as RestoreRecordsCommand).records)).toEqual([
      chunks[1],
      chunks[0],
    ]);
    expect(observed).toEqual(['delete-interaction', 'delete-interaction']);
    bus.commands.length = 0;
    expect(
      (
        await service.applyRedo(toUndoRedoStackReplayContext(context), tableId, context.windowId)
      )._unsafeUnwrap()
    ).toEqual({ entryCount: 2 });
    expect(
      bus.commands.map((command) => {
        const recordIds = (command as DeleteRecordsCommand).recordIds;
        expect(recordIds).toBeDefined();
        return recordIds!.map(String);
      })
    ).toEqual(chunks.map((chunk) => chunk.map((snapshot) => snapshot.recordId)));
    (
      await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId)
    )._unsafeUnwrap();
    (
      await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId)
    )._unsafeUnwrap();
    expect((bus.lastCommand as UpdateRecordCommand).fieldValues.get('fld1')).toBe(
      'independent-old'
    );
  });

  it.each([
    { malformed: 'records', side: 'undoCommand' },
    { malformed: 'records', side: 'redoCommand' },
    { malformed: 'record version', side: 'undoCommand' },
    { malformed: 'record version', side: 'redoCommand' },
  ] as const)(
    'rejects malformed $malformed in a later grouped $side before the first mutation',
    async ({ malformed, side }) => {
      const store = new MemoryUndoRedoStore();
      const bus = new FakeCommandBus();
      const service = new UndoRedoStackService(store, bus);
      const context = buildContext();
      const { tableId, recordId } = buildRecordIds();
      const scope = buildScope(context, tableId);
      const valid = createUndoRedoCommand('RestoreRecords', {
        tableId: tableId.toString(),
        records: [{ recordId: recordId.toString(), fields: { fld1: 'retained' }, version: 2 }],
      });
      // Legacy history can contain structurally invalid data despite the persisted TypeScript type.
      const invalid = {
        ...valid,
        payload: {
          ...valid.payload,
          records:
            malformed === 'records' ? null : [{ ...valid.payload.records[0]!, version: 'invalid' }],
        },
      } as unknown as typeof valid;
      (
        await store.append(scope, {
          scope,
          groupId: 'malformed-metadata',
          groupPosition: 'start',
          undoCommand: side === 'undoCommand' ? invalid : valid,
          redoCommand: side === 'redoCommand' ? invalid : valid,
          createdAt: '2026-01-01T00:00:00Z',
        })
      )._unsafeUnwrap();
      (
        await store.append(scope, {
          scope,
          groupId: 'malformed-metadata',
          groupPosition: 'continue',
          undoCommand: valid,
          redoCommand: valid,
          createdAt: '2026-01-01T00:00:01Z',
        })
      )._unsafeUnwrap();
      const history = (await store.list(scope))._unsafeUnwrap();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const rejected = await service.applyUndo(
          toUndoRedoStackReplayContext(context),
          tableId,
          context.windowId
        );
        expect(rejected.isErr()).toBe(true);
        expect(rejected._unsafeUnwrapErr().code).not.toBe('undo_redo.reservation_conflict');
        expect(bus.commands).toHaveLength(0);
        expect((await store.list(scope))._unsafeUnwrap()).toEqual(history);

        const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
        expect(reservation.executedLeafIndex).toBe(0);
        expect(
          (await store.readReservedEntry(scope, reservation.token, 0))._unsafeUnwrap()
        ).toEqual(history[1]);
        expect(
          (await store.readReservedEntry(scope, reservation.token, 1))._unsafeUnwrap()
        ).toEqual(history[0]);
        (await store.abort(scope, reservation.token))._unsafeUnwrap();
        expect((await store.reserve(scope, 'redo'))._unsafeUnwrap()).toBeNull();
      }
    }
  );

  it('rejects a malformed later batch leaf before executing the valid first leaf', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const scope = buildScope(context, tableId);
    const valid = createUndoRedoCommand('RestoreRecords', {
      tableId: tableId.toString(),
      records: [{ recordId: recordId.toString(), fields: { fld1: 'valid' }, version: 2 }],
    });
    const malformed = {
      ...valid,
      payload: {
        ...valid.payload,
        records: [{ ...valid.payload.records[0]!, version: 'invalid' }],
      },
    } as unknown as typeof valid;
    (
      await store.append(scope, {
        scope,
        undoCommand: createUndoRedoCommand('Batch', [valid, malformed]),
        redoCommand: valid,
        createdAt: '2026-01-01T00:00:00Z',
      })
    )._unsafeUnwrap();
    const history = (await store.list(scope))._unsafeUnwrap();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rejected = await service.applyUndo(
        toUndoRedoStackReplayContext(context),
        tableId,
        context.windowId
      );
      expect(rejected.isErr()).toBe(true);
      expect(rejected._unsafeUnwrapErr().code).not.toBe('undo_redo.reservation_conflict');
      expect(bus.commands).toHaveLength(0);
      expect((await store.list(scope))._unsafeUnwrap()).toEqual(history);
      const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
      expect(reservation.executedLeafIndex).toBe(0);
      (await store.abort(scope, reservation.token))._unsafeUnwrap();
      expect((await store.reserve(scope, 'redo'))._unsafeUnwrap()).toBeNull();
    }
  });

  it('preflights malformed older entries before executing and resumes grouped partial failures by leaf', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const scope = buildScope(context, tableId);
    const commands = ['h', 'i', 'j'].map((letter) =>
      createUndoRedoCommand('RestoreRecords', {
        tableId: tableId.toString(),
        records: [{ recordId: `rec${letter.repeat(16)}`, fields: { fld1: letter } }],
      })
    );
    const malformed = { ...commands[0]!, version: 999 };
    (
      await store.append(scope, {
        scope,
        groupId: 'malformed',
        groupPosition: 'start',
        undoCommand: malformed,
        redoCommand: commands[0]!,
        createdAt: '2026-01-01T00:00:00Z',
      })
    )._unsafeUnwrap();
    (
      await store.append(scope, {
        scope,
        groupId: 'malformed',
        groupPosition: 'continue',
        undoCommand: commands[1]!,
        redoCommand: commands[1]!,
        createdAt: '2026-01-01T00:00:01Z',
      })
    )._unsafeUnwrap();
    expect(
      (
        await service.applyUndo(toUndoRedoStackReplayContext(context), tableId, context.windowId)
      ).isErr()
    ).toBe(true);
    expect(bus.commands).toHaveLength(0);
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(reservation.executedLeafIndex).toBe(0);
    (await store.abort(scope, reservation.token))._unsafeUnwrap();

    const partialContext = { ...context, windowId: 'partial-window' };
    const partialScope = buildScope(partialContext, tableId);
    for (const command of [createUndoRedoCommand('Batch', commands.slice(0, 2)), commands[2]!]) {
      (
        await store.append(partialScope, {
          scope: partialScope,
          groupId: 'partial',
          groupPosition: command.type === 'Batch' ? 'start' : 'continue',
          undoCommand: command,
          redoCommand: command,
          createdAt: '2026-01-01T00:00:00Z',
        })
      )._unsafeUnwrap();
    }
    bus.failAfterRemaining = 3;
    expect(
      (
        await service.applyUndo(
          toUndoRedoStackReplayContext(partialContext),
          tableId,
          partialContext.windowId
        )
      ).isErr()
    ).toBe(true);
    const retried = await service.applyUndo(
      toUndoRedoStackReplayContext(partialContext),
      tableId,
      partialContext.windowId
    );
    expect(retried._unsafeUnwrap()).toEqual({ entryCount: 2 });
    expect(
      bus.commands.map((command) => (command as RestoreRecordsCommand).records[0]?.fields.fld1)
    ).toEqual(['j', 'h', 'i', 'i']);
    expect(
      (
        await service.applyUndo(
          toUndoRedoStackReplayContext(partialContext),
          tableId,
          partialContext.windowId
        )
      )._unsafeUnwrap()
    ).toBeNull();
  });

  it('preflights every grouped entry and repeats bounded notifications on cursor-only retries', async () => {
    const store = new FlakyCommitStore(3);
    const bus = new FakeCommandBus();
    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    for (const letter of ['k', 'l']) {
      (
        await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
          tableId,
          groupId: 'notification-group',
          groupPosition: letter === 'k' ? 'start' : 'continue',
          deletedRecords: [{ recordId: `rec${letter.repeat(16)}`, fields: { fld1: letter } }],
        })
      )._unsafeUnwrap();
    }
    const history = (await store.list(buildScope(context, tableId)))._unsafeUnwrap();
    const entries = [...history].reverse();
    const preflighted: UndoEntry[] = [];
    const seen: string[] = [];
    const options = {
      beforeReplay: async (entry: UndoEntry) => {
        seen.push('preflight');
        expect(bus.commands).toHaveLength(0);
        expect(entry.undoCommand.type).toBe('RestoreRecords');
        expect(entry).toEqual(entries[preflighted.length]);
        expect(entry.requestId).toBe(context.requestId);
        preflighted.push(entry);
        return ok(undefined);
      },
      onEntryReplayed: async (entry: UndoEntry) => {
        if (entry.undoCommand.type === 'RestoreRecords') {
          seen.push(entry.undoCommand.payload.records[0]!.recordId);
        }
      },
    };
    expect(
      (
        await service.applyUndo(
          toUndoRedoStackReplayContext(context),
          tableId,
          context.windowId,
          options
        )
      ).isErr()
    ).toBe(true);
    expect(bus.commands).toHaveLength(2);
    expect(
      (
        await service.applyUndo(
          toUndoRedoStackReplayContext(context),
          tableId,
          context.windowId,
          options
        )
      )._unsafeUnwrap()
    ).toEqual({ entryCount: 2 });
    expect(bus.commands).toHaveLength(2);
    const ids = [`rec${'l'.repeat(16)}`, `rec${'k'.repeat(16)}`];
    expect(seen).toEqual(['preflight', 'preflight', ...ids, ...ids]);
    expect(preflighted).toEqual(entries);
  });

  it('defers notifications until Phase 2 flushes self-referential links across grouped RestoreRecords entries', async () => {
    const store = new MemoryUndoRedoStore();
    const seen: string[] = [];
    const dispatched: Array<{
      selfReferentialLinksOnly?: boolean;
      cleanupTrashRecordIds?: ReadonlyArray<string>;
      recordIds: ReadonlyArray<string>;
      fields: ReadonlyArray<Readonly<Record<string, unknown>>>;
    }> = [];
    const selfLinkFieldId = `fld${'s'.repeat(16)}`;
    const parentId = `rec${'p'.repeat(16)}`;
    const childId = `rec${'c'.repeat(16)}`;

    const bus: ICommandBus = {
      async execute<TCommand, TResult>(
        _context: IExecutionContext,
        command: TCommand
      ): Promise<Result<TResult, DomainError>> {
        const restore = command as unknown as RestoreRecordsCommand;
        seen.push(restore.selfReferentialLinksOnly ? 'phase2' : 'phase1');
        dispatched.push({
          selfReferentialLinksOnly: restore.selfReferentialLinksOnly,
          cleanupTrashRecordIds: restore.cleanupTrashRecordIds,
          recordIds: restore.records.map((r) => r.recordId),
          fields: restore.records.map((r) => r.fields),
        });
        restore.onTableSelfLinkFieldsResolved?.(new Set([selfLinkFieldId]));
        if (!restore.selfReferentialLinksOnly && restore.deferSelfReferentialLinks) {
          for (const rec of restore.records) {
            const linkValue = rec.fields[selfLinkFieldId];
            if (linkValue !== undefined) {
              restore.deferSelfReferentialLinks.push({
                recordId: rec.recordId,
                fields: { [selfLinkFieldId]: linkValue },
                cleanupTrash: true,
              });
            }
          }
        }
        return ok(undefined as TResult);
      },
    };

    const service = new UndoRedoStackService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();

    (
      await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
        tableId,
        groupId: 'self-link-group',
        groupPosition: 'start',
        deletedRecords: [{ recordId: parentId, fields: { fldTitle: 'Parent' } }],
      })
    )._unsafeUnwrap();
    (
      await service.appendRecordDelete(toUndoRedoStackAppendContext(context), {
        tableId,
        groupId: 'self-link-group',
        groupPosition: 'continue',
        deletedRecords: [
          {
            recordId: childId,
            fields: { fldTitle: 'Child', [selfLinkFieldId]: { id: parentId, title: 'Parent' } },
          },
        ],
      })
    )._unsafeUnwrap();

    const replayResult = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId,
      {
        onEntryReplayed: async (entry) => {
          if (entry.undoCommand.type === 'RestoreRecords') {
            seen.push(`notify:${entry.undoCommand.payload.records[0]!.recordId}`);
          }
        },
      }
    );

    expect(replayResult._unsafeUnwrap()).toEqual({ entryCount: 2 });
    expect(seen).toEqual(['phase1', 'phase1', `notify:${parentId}`, 'phase2', `notify:${childId}`]);
    expect(dispatched).toHaveLength(3);
    expect(dispatched[2]).toEqual({
      selfReferentialLinksOnly: true,
      cleanupTrashRecordIds: [childId],
      recordIds: [childId],
      fields: [{ [selfLinkFieldId]: { id: parentId, title: 'Parent' } }],
    });
  });
});
