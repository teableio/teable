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

class FakeRedis {
  readonly locks = new Map<string, string>();
  setCalls = 0;
  delCalls: string[] = [];
  getOverride?: (key: string) => string | undefined;

  async set(key: string, value: string, ...args: unknown[]) {
    this.setCalls += 1;
    await Promise.resolve();
    if (args.includes('NX') && this.locks.has(key)) {
      return null;
    }
    this.locks.set(key, value);
    return 'OK';
  }

  async get(key: string) {
    if (this.getOverride) {
      return this.getOverride(key);
    }
    return this.locks.get(key);
  }

  async del(key: string) {
    this.delCalls.push(key);
    this.locks.delete(key);
    return 1;
  }

  async eval(script: string, _numKeys: number, key: unknown, token: unknown) {
    const lockKey = String(key);
    const current = this.getOverride?.(lockKey) ?? this.locks.get(lockKey);
    if (current !== String(token)) {
      return 0;
    }
    if (script.includes('DEL')) {
      this.delCalls.push(lockKey);
      this.locks.delete(lockKey);
      return 1;
    }
    return 1;
  }
}

class MemoryKeyvWithRedis extends MemoryKeyv {
  readonly opts: { store: { redis: FakeRedis } };

  constructor(redis: FakeRedis) {
    super();
    this.opts = { store: { redis } };
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

  it('keeps both entries when two appends run concurrently', async () => {
    const store = new KeyvUndoRedoStore(new MemoryKeyv());
    const scope = buildScope();

    await Promise.all([
      store.append(scope, buildEntry(scope, 1)),
      store.append(scope, buildEntry(scope, 2)),
    ]);

    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed.map((entry) => entry.requestId).sort()).toEqual(['req-1', 'req-2']);
  });

  it('rejects append while an undo reservation is held', async () => {
    const store = new KeyvUndoRedoStore(new MemoryKeyv());
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();

    const reserved = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(reserved).not.toBeNull();

    const appendResult = await store.append(scope, buildEntry(scope, 2));
    expect(appendResult.isErr()).toBe(true);
    expect(appendResult._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');

    (await store.abort(scope, reserved!.token))._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, 2)))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap()).toHaveLength(2);
  });

  it('reuses a succeeded reservation instead of starting a new undo', async () => {
    const store = new KeyvUndoRedoStore(new MemoryKeyv());
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();

    const reserved = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(reserved?.executionStatus).toBe('reserved');
    (await store.markSucceeded(scope, reserved!.token))._unsafeUnwrap();

    const again = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(again?.token).toBe(reserved!.token);
    expect(again?.executionStatus).toBe('succeeded');
    expect(again?.operationId).toBe(reserved!.operationId);

    (await store.commit(scope, again!.token))._unsafeUnwrap();
    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed).toHaveLength(1);
    expect((await store.redo(scope))._unsafeUnwrap()?.requestId).toBe('req-1');
  });

  it('keeps both entries when two store instances append through a shared Redis lock', async () => {
    const redis = new FakeRedis();
    const keyv = new MemoryKeyvWithRedis(redis);
    const storeA = new KeyvUndoRedoStore(keyv, { lockRetryDelayMs: 0 });
    const storeB = new KeyvUndoRedoStore(keyv, { lockRetryDelayMs: 0 });
    const scope = buildScope();

    await Promise.all([
      storeA.append(scope, buildEntry(scope, 1)),
      storeB.append(scope, buildEntry(scope, 2)),
    ]);

    const listed = (await storeA.list(scope))._unsafeUnwrap();
    expect(listed.map((entry) => entry.requestId).sort()).toEqual(['req-1', 'req-2']);
    expect(redis.setCalls).toBeGreaterThan(0);
  });

  it('lets a later undo take over after the reservation lease expires', async () => {
    let now = 1_000;
    const store = new KeyvUndoRedoStore(new MemoryKeyv(), {
      now: () => now,
      leaseMs: 15_000,
    });
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();

    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(first).not.toBeNull();

    const live = await store.reserve(scope, 'undo');
    expect(live.isErr()).toBe(true);

    now = 16_001;
    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(taken?.token).not.toBe(first!.token);
    expect(taken?.operationId).toBe(first!.operationId);
  });

  it('does not append unlocked when the Redis lock cannot be acquired', async () => {
    const redis = {
      setCalls: 0,
      async set() {
        this.setCalls += 1;
        return null;
      },
      async del() {
        return 1;
      },
    };
    const keyv = new MemoryKeyvWithRedis(redis);
    const store = new KeyvUndoRedoStore(keyv, { lockRetryDelayMs: 0, lockAttempts: 20 });
    const scope = buildScope();

    const result = await store.append(scope, buildEntry(scope, 1));
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('undo_redo.scope_lock_timeout');
    expect((await store.list(scope))._unsafeUnwrap()).toHaveLength(0);
  });

  it('rejects append when expectedRevision does not match', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();

    const stale = await store.append(scope, buildEntry(scope, 2), 0);
    expect(stale.isErr()).toBe(true);
    expect(stale._unsafeUnwrapErr().code).toBe('undo_redo.revision_conflict');

    (await store.append(scope, buildEntry(scope, 2), 1))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap()).toHaveLength(2);
  });

  it('does not carry executedLeafIndex into a different replay mode after lease expiry', async () => {
    let now = 1_000;
    const store = new KeyvUndoRedoStore(new Keyv(), { now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, 2)))._unsafeUnwrap();

    const undo = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    (await store.commit(scope, undo!.token))._unsafeUnwrap();
    const redo = (await store.reserve(scope, 'redo'))._unsafeUnwrap();
    (await store.markProgress(scope, redo!.token, 2))._unsafeUnwrap();
    now = 16_001;

    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(taken?.mode).toBe('undo');
    expect(taken?.executedLeafIndex).toBe(0);
  });

  it('commits a succeeded reservation before appending a new entry', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();
    const reserved = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    (await store.markSucceeded(scope, reserved!.token))._unsafeUnwrap();

    (await store.append(scope, buildEntry(scope, 2)))._unsafeUnwrap();
    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.requestId).toBe('req-2');
  });

  it('does not delete a Redis lock held by another token', async () => {
    const redis = new FakeRedis();
    redis.getOverride = () => 'stolen-holder';
    const store = new KeyvUndoRedoStore(new MemoryKeyvWithRedis(redis));
    const scope = buildScope();

    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();
    expect(redis.delCalls).toHaveLength(0);
  });

  it('takes over a reservation that persisted without a finite lease', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();
    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap();

    const metaKey = [...keyv.values.keys()].find((key) => !key.includes(':entry:'));
    expect(metaKey).toBeDefined();
    const meta = keyv.values.get(metaKey!) as { reservation?: { leaseUntil?: number } };
    expect(meta.reservation).toBeDefined();
    delete meta.reservation!.leaseUntil;

    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(taken?.token).not.toBe(first!.token);
    expect(taken?.executionStatus).toBe('reserved');
  });
});
