import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { ApplyFieldSnapshotCommand } from '../../commands/ApplyFieldSnapshotCommand';
import type { ApplyRecordOrdersCommand } from '../../commands/ApplyRecordOrdersCommand';
import type { ApplyViewSnapshotCommand } from '../../commands/ApplyViewSnapshotCommand';
import type { DeleteFieldCommand } from '../../commands/DeleteFieldCommand';
import type { DeleteViewCommand } from '../../commands/DeleteViewCommand';
import type { DisableViewShareCommand } from '../../commands/DisableViewShareCommand';
import type { EnableViewShareCommand } from '../../commands/EnableViewShareCommand';
import type { ReplayFieldTypeConversionCommand } from '../../commands/ReplayFieldTypeConversionCommand';
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
    const undoEntry = undoResult._unsafeUnwrap();
    if (undoEntry?.undoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord undo command');
    }
    expect(undoEntry.undoCommand.payload.recordId).toBe(recordId.toString());
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
    const redoEntry = redoResult._unsafeUnwrap();
    if (redoEntry?.redoCommand.type !== 'UpdateRecord') {
      throw new Error('Expected UpdateRecord redo command');
    }
    expect(redoEntry.redoCommand.payload.recordId).toBe(recordId.toString());
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
    expect(undoResult._unsafeUnwrap()?.undoCommand.type).toBe('ApplyRecordOrders');
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
    expect(undoResult._unsafeUnwrap()?.undoCommand.type).toBe('DeleteField');
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const deleteFieldCommand = bus.lastCommand as DeleteFieldCommand;
    expect(deleteFieldCommand.fieldId.toString()).toBe(fieldId);

    const redoResult = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redoResult._unsafeUnwrap()?.redoCommand.type).toBe('ApplyFieldSnapshot');
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
    expect(undoResult._unsafeUnwrap()?.undoCommand.type).toBe('ReplayFieldTypeConversion');
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
    expect(firstUndo._unsafeUnwrap()?.recordVersionBefore).toBe(2);
    expect((bus.lastCommand as UpdateRecordCommand).fieldValues.get('fld1')).toBe('v1');

    const secondUndo = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(secondUndo._unsafeUnwrap()?.recordVersionBefore).toBe(1);
    expect((bus.lastCommand as UpdateRecordCommand).fieldValues.get('fld1')).toBe('v0');

    const redo = await service.applyRedo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(redo._unsafeUnwrap()?.recordVersionAfter).toBe(2);
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

    await service.appendEntry(toUndoRedoStackAppendContext(context), tableId, {
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
    });

    const result = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Unsupported undo/redo command version');
    expect(bus.commands).toHaveLength(0);

    const retried = await service.applyUndo(
      toUndoRedoStackReplayContext(context),
      tableId,
      context.windowId
    );
    expect(retried.isErr()).toBe(true);
    expect(retried._unsafeUnwrapErr().message).toContain('Unsupported undo/redo command version');
    expect(bus.commands).toHaveLength(0);
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
    expect(retried._unsafeUnwrap()?.undoCommand.type).toBe('UpdateRecord');
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
    expect(retried._unsafeUnwrap()?.undoCommand.type).toBe('Batch');
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
    expect(result._unsafeUnwrap()?.undoCommand.type).toBe('UpdateRecord');
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
    expect(retried._unsafeUnwrap()?.undoCommand.type).toBe('UpdateRecord');
    expect(bus.commands).toHaveLength(1);
  });

  it('renews the reservation so a long replay is not taken over', async () => {
    class RecordingStore extends MemoryUndoRedoStore {
      renewCalls = 0;

      override async renew(scope: UndoScope, token: string) {
        this.renewCalls += 1;
        return super.renew(scope, token);
      }
    }

    const store = new RecordingStore();
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
    expect(store.renewCalls).toBeGreaterThan(0);
    expect(bus.commands).toHaveLength(1);
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
});
