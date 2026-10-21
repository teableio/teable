import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableName } from '../../domain/table/TableName';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewName } from '../../domain/table/views/ViewName';
import { ViewOrder } from '../../domain/table/views/ViewOrder';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { UndoEntry } from '../../ports/UndoRedoStore';
import { ViewUndoRedoService } from './ViewUndoRedoService';

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Views')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  builder.view().grid().withName(ViewName.create('Second')._unsafeUnwrap()).done();
  const table = builder.build()._unsafeUnwrap();
  const fieldId = table.primaryFieldId().toString();
  table.views().forEach((view, index) => {
    view.setColumnMeta(
      ViewColumnMeta.create({ [fieldId]: { order: 0, width: 200 + index } })._unsafeUnwrap()
    );
    view.setQueryDefaults(ViewQueryDefaults.rehydrate({})._unsafeUnwrap());
    view.setOptions({ rowHeight: index === 0 ? 'short' : 'tall' });
    view.setOrder(ViewOrder.rehydrate(index)._unsafeUnwrap());
  });
  return table;
};

const context: IExecutionContext = {
  actorId: ActorId.create('actor')._unsafeUnwrap(),
  windowId: 'window',
};

const setup = () => {
  const appendEntry = vi.fn(async (..._args: unknown[]) => ok(undefined));
  const service = new ViewUndoRedoService({ appendEntry } as never);
  return { service, appendEntry };
};

describe('ViewUndoRedoService', () => {
  it('captures replayable View child state and records create/delete commands', async () => {
    const table = buildTable();
    const { service, appendEntry } = setup();
    const snapshot = service.capture(table, table.views()[0]!.id().toString())._unsafeUnwrap();

    expect(snapshot).toMatchObject({
      id: table.views()[0]!.id().toString(),
      type: 'grid',
      order: 0,
      columnMeta: {
        [table.primaryFieldId().toString()]: { order: 0 },
      },
      options: { rowHeight: 'short' },
    });

    await service.appendCreate(context, table, snapshot);
    let entry = appendEntry.mock.calls[0]![2] as Omit<
      UndoEntry,
      'scope' | 'createdAt' | 'requestId'
    >;
    expect(entry.undoCommand).toMatchObject({
      type: 'DeleteView',
      payload: { tableId: table.id().toString(), viewId: snapshot.id },
    });
    expect(entry.redoCommand).toMatchObject({
      type: 'ApplyViewSnapshot',
      payload: { snapshot },
    });

    await service.appendDelete(context, table, snapshot);
    entry = appendEntry.mock.calls[1]![2] as Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId'>;
    expect(entry.undoCommand.type).toBe('ApplyViewSnapshot');
    expect(entry.redoCommand.type).toBe('DeleteView');
  });

  it('records every changed View as one batch and ignores audit-only changes', async () => {
    const table = buildTable();
    const { service, appendEntry } = setup();
    const previous = service.captureAll(table)._unsafeUnwrap();
    const changed = previous.map((snapshot, index) => ({
      ...snapshot,
      order: (snapshot.order ?? 0) + 10,
      auditMetadata: {
        createdBy: 'actor',
        createdTime: 'now',
        lastModifiedTime: `later-${index}`,
      },
    }));

    await service.appendUpdate(context, table, previous, changed);
    const entry = appendEntry.mock.calls[0]![2] as Omit<
      UndoEntry,
      'scope' | 'createdAt' | 'requestId'
    >;
    expect(entry.undoCommand.type).toBe('Batch');
    expect(entry.redoCommand.type).toBe('Batch');
    if (entry.undoCommand.type !== 'Batch') throw new Error('Expected a batch');
    expect(entry.undoCommand.payload).toHaveLength(2);
    expect(entry.undoCommand.payload.every((command) => command.type === 'ApplyViewSnapshot')).toBe(
      true
    );

    appendEntry.mockClear();
    const auditOnly = previous.map((snapshot) => ({
      ...snapshot,
      auditMetadata: {
        createdBy: 'actor',
        createdTime: 'now',
        lastModifiedTime: 'later',
      },
    }));
    await service.appendUpdate(context, table, previous, auditOnly);
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it('records share lifecycle commands without persisting a revoked credential', async () => {
    const table = buildTable();
    const viewId = table.views()[0]!.id().toString();
    const { service, appendEntry } = setup();

    await service.appendShareLifecycle(context, table, viewId, 'enable');
    let entry = appendEntry.mock.calls[0]![2] as Omit<
      UndoEntry,
      'scope' | 'createdAt' | 'requestId'
    >;
    expect(entry.undoCommand).toMatchObject({
      type: 'DisableViewShare',
      payload: { tableId: table.id().toString(), viewId },
    });
    expect(entry.redoCommand).toMatchObject({
      type: 'EnableViewShare',
      payload: { tableId: table.id().toString(), viewId },
    });

    await service.appendShareLifecycle(context, table, viewId, 'disable');
    entry = appendEntry.mock.calls[1]![2] as Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId'>;
    expect(entry.undoCommand.type).toBe('EnableViewShare');
    expect(entry.redoCommand.type).toBe('DisableViewShare');
    expect(JSON.stringify(entry)).not.toContain('shr');
  });
});
