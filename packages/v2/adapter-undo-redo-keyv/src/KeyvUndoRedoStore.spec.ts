import Keyv from 'keyv';
import { describe, expect, it } from 'vitest';

import { ActorId, TableId, createUndoRedoCommand } from '@teable/v2-core';
import type { UndoEntry, UndoScope } from '@teable/v2-core';

import { KeyvUndoRedoStore } from './KeyvUndoRedoStore';

const buildScope = (): UndoScope => ({
  actorId: ActorId.create('usrUndoRedoStore01')._unsafeUnwrap(),
  tableId: TableId.create(`tbl${'u'.repeat(16)}`)._unsafeUnwrap(),
  windowId: 'window-1',
});

const buildEntry = (scope: UndoScope, index: number): UndoEntry => ({
  scope,
  undoCommand: createUndoRedoCommand('UpdateRecord', {
    tableId: scope.tableId.toString(),
    recordId: `rec${String(index).padStart(16, '0')}`,
    fields: { fld1: `old-${index}` },
    fieldKeyType: 'id',
    typecast: false,
  }),
  redoCommand: createUndoRedoCommand('UpdateRecord', {
    tableId: scope.tableId.toString(),
    recordId: `rec${String(index).padStart(16, '0')}`,
    fields: { fld1: `new-${index}` },
    fieldKeyType: 'id',
    typecast: false,
  }),
  createdAt: `2026-03-07T00:00:0${index}.000Z`,
  requestId: `req-${index}`,
});

describe('KeyvUndoRedoStore', () => {
  it('supports append, undo, redo, and list with scoped entries', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();
    const entry1 = buildEntry(scope, 1);
    const entry2 = buildEntry(scope, 2);

    await store.append(scope, entry1);
    await store.append(scope, entry2);

    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.scope.windowId).toBe(scope.windowId);
    expect(listed[1]?.requestId).toBe('req-2');

    const undoEntry = (await store.undo(scope))._unsafeUnwrap();
    expect(undoEntry?.requestId).toBe('req-2');

    const redoEntry = (await store.redo(scope))._unsafeUnwrap();
    expect(redoEntry?.requestId).toBe('req-2');
  });

  it('drops redo history after appending past the cursor', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();

    await store.append(scope, buildEntry(scope, 1));
    await store.append(scope, buildEntry(scope, 2));

    const undone = (await store.undo(scope))._unsafeUnwrap();
    expect(undone?.requestId).toBe('req-2');

    await store.append(scope, buildEntry(scope, 3));

    const redone = (await store.redo(scope))._unsafeUnwrap();
    expect(redone).toBeNull();

    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed.map((entry) => entry.requestId)).toEqual(['req-1', 'req-3']);
  });

  it('enforces the maxEntries retention window', async () => {
    const store = new KeyvUndoRedoStore(new Keyv(), { maxEntries: 2 });
    const scope = buildScope();

    await store.append(scope, buildEntry(scope, 1));
    await store.append(scope, buildEntry(scope, 2));
    await store.append(scope, buildEntry(scope, 3));

    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed.map((entry) => entry.requestId)).toEqual(['req-2', 'req-3']);
  });
});
