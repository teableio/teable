import { brotliCompressSync } from 'node:zlib';

import Keyv from 'keyv';
import { describe, expect, it } from 'vitest';

import { ActorId, TableId, createUndoRedoCommand } from '@teable/v2-core';
import type { UndoEntry, UndoScope } from '@teable/v2-core';

import { KeyvUndoRedoStore } from './KeyvUndoRedoStore';

class MemoryKeyv {
  readonly values = new Map<string, unknown>();
  readonly getCalls: string[] = [];

  async get(key: string) {
    this.getCalls.push(key);
    return this.values.get(key);
  }

  async set(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
    return true;
  }

  resetGetCalls() {
    this.getCalls.length = 0;
  }
}

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

  it('compresses large persisted states with gzip and still supports undo/redo', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv, {
      compressionThresholdBytes: 256,
    });
    const scope = buildScope();
    const largeEntry: UndoEntry = {
      ...buildEntry(scope, 1),
      undoCommand: createUndoRedoCommand('RestoreRecords', {
        tableId: scope.tableId.toString(),
        records: Array.from({ length: 32 }, (_, index) => ({
          recordId: `rec${String(index).padStart(16, '0')}`,
          fields: {
            fldLarge: `value-${index}-${'x'.repeat(256)}`,
          },
        })),
      }),
      redoCommand: createUndoRedoCommand('DeleteRecords', {
        tableId: scope.tableId.toString(),
        recordIds: Array.from(
          { length: 32 },
          (_, index) => `rec${String(index).padStart(16, '0')}`
        ),
      }),
    };

    await store.append(scope, largeEntry);

    const compressedStoredValue = [...keyv.values.values()].find(
      (value): value is { format?: string } =>
        Boolean(value) && typeof value === 'object' && 'format' in value
    );
    expect(compressedStoredValue).toMatchObject({ format: 'gz64-json' });

    const undoEntry = (await store.undo(scope))._unsafeUnwrap();
    expect(undoEntry?.requestId).toBe(largeEntry.requestId);
    expect(undoEntry?.undoCommand.type).toBe('RestoreRecords');

    const redoEntry = (await store.redo(scope))._unsafeUnwrap();
    expect(redoEntry?.requestId).toBe(largeEntry.requestId);
  });

  it('reads legacy brotli-compressed entries written before the gzip switch', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId.toString()}:${scope.tableId.toString()}:${scope.windowId}`;
    const legacyEntry = {
      ...buildEntry(scope, 1),
      undoCommand: createUndoRedoCommand('RestoreRecords', {
        tableId: scope.tableId.toString(),
        records: Array.from({ length: 16 }, (_, index) => ({
          recordId: `rec${String(index).padStart(16, '0')}`,
          fields: {
            fldLarge: `value-${index}-${'x'.repeat(128)}`,
          },
        })),
      }),
    };
    const serialized = JSON.stringify({
      ...legacyEntry,
      scope: undefined,
    });

    keyv.values.set(scopeKey, {
      format: 'split-v1',
      entryIds: ['1'],
      cursor: 1,
      nextSequence: 2,
    });
    keyv.values.set(`${scopeKey}:entry:1`, {
      format: 'br64-json',
      data: brotliCompressSync(Buffer.from(serialized, 'utf8')).toString('base64'),
    });

    const undoEntry = (await store.undo(scope))._unsafeUnwrap();
    expect(undoEntry?.requestId).toBe(legacyEntry.requestId);
    expect(undoEntry?.undoCommand.type).toBe('RestoreRecords');
  });

  it('undos and redoes contiguous grouped entries as a single batch', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();

    await store.append(scope, buildEntry(scope, 1));
    await store.append(scope, { ...buildEntry(scope, 2), groupId: 'grp-1' });
    await store.append(scope, { ...buildEntry(scope, 3), groupId: 'grp-1' });

    const undoEntry = (await store.undo(scope))._unsafeUnwrap();
    expect(undoEntry?.undoCommand.type).toBe('Batch');
    expect(undoEntry?.redoCommand.type).toBe('Batch');
    expect(
      undoEntry?.undoCommand.type === 'Batch' ? undoEntry.undoCommand.payload : []
    ).toHaveLength(2);

    const listedAfterUndo = (await store.list(scope))._unsafeUnwrap();
    expect(listedAfterUndo).toHaveLength(3);

    const redoEntry = (await store.redo(scope))._unsafeUnwrap();
    expect(redoEntry?.redoCommand.type).toBe('Batch');
    expect(
      redoEntry?.redoCommand.type === 'Batch' ? redoEntry.redoCommand.payload : []
    ).toHaveLength(2);
  });

  it('appends in split mode without loading prior entry payloads', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();

    await store.append(scope, buildEntry(scope, 1));
    keyv.resetGetCalls();

    await store.append(scope, buildEntry(scope, 2));

    const scopeKey = `v2:undo-redo:${scope.actorId.toString()}:${scope.tableId.toString()}:${scope.windowId}`;
    const entryKeysRead = keyv.getCalls.filter((key) => key.startsWith(`${scopeKey}:entry:`));
    expect(entryKeysRead).toHaveLength(0);
    expect(keyv.getCalls).toEqual([scopeKey]);

    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed.map((entry) => entry.requestId)).toEqual(['req-1', 'req-2']);
  });
});
