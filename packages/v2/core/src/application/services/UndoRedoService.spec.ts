import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type { ApplyFieldSnapshotCommand } from '../../commands/ApplyFieldSnapshotCommand';
import type { ApplyRecordOrdersCommand } from '../../commands/ApplyRecordOrdersCommand';
import type { DeleteFieldCommand } from '../../commands/DeleteFieldCommand';
import type { ReplayFieldTypeConversionCommand } from '../../commands/ReplayFieldTypeConversionCommand';
import type { UpdateRecordCommand } from '../../commands/UpdateRecordCommand';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import { RecordId } from '../../domain/table/records/RecordId';
import { TableId } from '../../domain/table/TableId';
import type { ICommandBus } from '../../ports/CommandBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { MemoryUndoRedoStore } from '../../ports/memory/MemoryUndoRedoStore';
import type { ISpan, ITracer, SpanAttributes } from '../../ports/Tracer';
import { TeableSpanAttributes } from '../../ports/Tracer';
import { createUndoRedoCommand, type UndoEntry, type UndoScope } from '../../ports/UndoRedoStore';

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

  it('wraps record updates with schema side-effect commands when provided', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const context = buildContext();
    const { tableId, recordId } = buildRecordIds();
    const fieldId = `fld${'h'.repeat(16)}`;

    await service.recordUpdateRecord(context, {
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

  it('executes apply-record-orders undo entries via the command bus', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();

    await service.recordEntry(context, tableId, {
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

    const undoResult = await service.undo(context, tableId, context.windowId);
    expect(undoResult._unsafeUnwrap()?.undoCommand.type).toBe('ApplyRecordOrders');
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const applied = bus.lastCommand as ApplyRecordOrdersCommand;
    expect(applied.tableId.toString()).toBe(tableId.toString());
    expect(applied.records[0]?.order).toBe(1);
  });

  it('executes field snapshot replay and delete-field undo entries via the command bus', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const baseId = `bse${'f'.repeat(16)}`;
    const fieldId = `fld${'g'.repeat(16)}`;

    await service.recordEntry(context, tableId, {
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

    const undoResult = await service.undo(context, tableId, context.windowId);
    expect(undoResult._unsafeUnwrap()?.undoCommand.type).toBe('DeleteField');
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const deleteFieldCommand = bus.lastCommand as DeleteFieldCommand;
    expect(deleteFieldCommand.fieldId.toString()).toBe(fieldId);

    const redoResult = await service.redo(context, tableId, context.windowId);
    expect(redoResult._unsafeUnwrap()?.redoCommand.type).toBe('ApplyFieldSnapshot');
    expect(bus.lastContext?.undoRedo?.mode).toBe('redo');
    const applyFieldSnapshotCommand = bus.lastCommand as ApplyFieldSnapshotCommand;
    expect(applyFieldSnapshotCommand.snapshot.field.id).toBe(fieldId);
  });

  it('executes field type conversion replay via the command bus', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const context = buildContext();
    const { tableId } = buildRecordIds();
    const baseId = `bse${'j'.repeat(16)}`;
    const fieldId = `fld${'k'.repeat(16)}`;

    await service.recordEntry(context, tableId, {
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

    const undoResult = await service.undo(context, tableId, context.windowId);
    expect(undoResult._unsafeUnwrap()?.undoCommand.type).toBe('ReplayFieldTypeConversion');
    expect(bus.lastContext?.undoRedo?.mode).toBe('undo');
    const replayCommand = bus.lastCommand as ReplayFieldTypeConversionCommand;
    expect(replayCommand.snapshot.field.id).toBe(fieldId);
  });

  it('emits trace spans for undo/redo store access and replay execution', async () => {
    const store = new MemoryUndoRedoStore();
    const bus = new FakeCommandBus();
    const service = new UndoRedoService(store, bus);
    const tracer = new FakeTracer();
    const context: IExecutionContext = { ...buildContext(), tracer };
    const { tableId, recordId } = buildRecordIds();

    await service.recordEntry(context, tableId, {
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
        'teable.UndoRedoService.recordEntry',
        'teable.UndoRedoService.storeAppend',
      ])
    );
    const appendSpan = tracer.spans.find(
      (span) => span.name === 'teable.UndoRedoService.storeAppend'
    );
    expect(appendSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.undo_redo.undo_command_type': 'UpdateRecord',
      'teable.undo_redo.redo_command_type': 'UpdateRecord',
    });

    tracer.spans.length = 0;

    const undoResult = await service.undo(context, tableId, context.windowId);
    undoResult._unsafeUnwrap();

    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'teable.UndoRedoService.undo',
        'teable.UndoRedoService.storeUndo',
        'teable.UndoRedoService.executeCommandData',
      ])
    );
    const executeSpan = tracer.spans.find(
      (span) => span.name === 'teable.UndoRedoService.executeCommandData'
    );
    expect(executeSpan?.attributes).toMatchObject({
      [TeableSpanAttributes.VERSION]: 'v2',
      [TeableSpanAttributes.TABLE_ID]: tableId.toString(),
      'teable.undo_redo.command_type': 'UpdateRecord',
      'teable.undo_redo.mode': 'undo',
    });
  });
});
