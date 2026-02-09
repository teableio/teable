import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { TableId } from '../../domain/table/TableId';
import type { UndoEntry, UndoScope } from '../UndoRedoStore';

import { MemoryUndoRedoStore } from './MemoryUndoRedoStore';

const buildScope = (): UndoScope => {
  const actorId = ActorId.create('actor')._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  return { actorId, tableId, windowId: 'window-1' };
};

const buildEntry = (scope: UndoScope, recordId: string): UndoEntry => ({
  scope,
  undoCommand: {
    type: 'UpdateRecord',
    version: 1,
    payload: {
      tableId: scope.tableId.toString(),
      recordId,
      fields: { fld: 'old' },
      fieldKeyType: 'id',
      typecast: false,
    },
  },
  redoCommand: {
    type: 'UpdateRecord',
    version: 1,
    payload: {
      tableId: scope.tableId.toString(),
      recordId,
      fields: { fld: 'new' },
      fieldKeyType: 'id',
      typecast: false,
    },
  },
  recordVersionBefore: 1,
  recordVersionAfter: 2,
  createdAt: new Date().toISOString(),
});

describe('MemoryUndoRedoStore', () => {
  it('supports append, undo, redo, and truncates redo tail', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();
    const entry1 = buildEntry(scope, `rec${'1'.repeat(16)}`);
    const entry2 = buildEntry(scope, `rec${'2'.repeat(16)}`);

    const redoRecordId = (entry?: UndoEntry | null): string | undefined => {
      if (!entry) return undefined;
      if (entry.redoCommand.type !== 'UpdateRecord') {
        throw new Error('Expected UpdateRecord redo command');
      }
      return entry.redoCommand.payload.recordId;
    };

    (await store.append(scope, entry1))._unsafeUnwrap();
    (await store.append(scope, entry2))._unsafeUnwrap();

    const undo1 = (await store.undo(scope))._unsafeUnwrap();
    expect(redoRecordId(undo1)).toBe(redoRecordId(entry2));

    const undo2 = (await store.undo(scope))._unsafeUnwrap();
    expect(redoRecordId(undo2)).toBe(redoRecordId(entry1));

    const undo3 = (await store.undo(scope))._unsafeUnwrap();
    expect(undo3).toBeNull();

    const redo1 = (await store.redo(scope))._unsafeUnwrap();
    expect(redoRecordId(redo1)).toBe(redoRecordId(entry1));

    // Undo once, then append should clear redo tail
    (await store.undo(scope))._unsafeUnwrap();
    const entry3 = buildEntry(scope, `rec${'3'.repeat(16)}`);
    (await store.append(scope, entry3))._unsafeUnwrap();

    const redoAfterAppend = (await store.redo(scope))._unsafeUnwrap();
    expect(redoAfterAppend).toBeNull();

    const list = (await store.list(scope))._unsafeUnwrap();
    expect(list.map((entry) => redoRecordId(entry))).toEqual([redoRecordId(entry3)]);
  });
});
