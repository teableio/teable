import { brotliCompressSync } from 'node:zlib';

import Keyv from 'keyv';
import { describe, expect, it } from 'vitest';

import { ActorId, TableId, createUndoRedoCommand } from '@teable/v2-core';
import type { UndoEntryInput, UndoScope } from '@teable/v2-core';

import { KeyvUndoRedoStore } from './KeyvUndoRedoStore';

class MemoryKeyv {
  readonly values = new Map<string, unknown>();
  readonly getCalls: string[] = [];
  readonly setCalls: string[] = [];
  readonly expires = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(
    key: string,
    options: { raw: true }
  ): Promise<Keyv.DeserializedData<unknown> | undefined>;
  async get(key: string, options?: { raw?: false }): Promise<unknown>;
  async get(
    key: string[],
    options: { raw: true }
  ): Promise<Array<Keyv.DeserializedData<unknown> | undefined>>;
  async get(key: string[], options?: { raw?: false }): Promise<unknown[]>;
  async get(key: string | string[], options?: { raw?: boolean }) {
    const raw = options?.raw === true;
    return Array.isArray(key) ? key.map((item) => this.getOnce(item, raw)) : this.getOnce(key, raw);
  }

  private getOnce(key: string, raw: boolean) {
    this.getCalls.push(key);
    const expires = this.expires.get(key);
    if (expires !== undefined && expires <= this.now()) return undefined;
    const value = this.values.get(key);
    return raw ? (value === undefined ? undefined : { value, expires }) : value;
  }

  async set(key: string, value: unknown, ttlMs?: number): Promise<true> {
    this.setCalls.push(key);
    this.values.set(key, value);
    if (ttlMs === undefined) this.expires.delete(key);
    else this.expires.set(key, this.now() + ttlMs);
    return true;
  }

  async delete(key: string | string[]): Promise<boolean> {
    if (Array.isArray(key)) {
      const deleted = key.map((item) => this.deleteOnce(item));
      return deleted.every(Boolean);
    }
    return this.deleteOnce(key);
  }

  private deleteOnce(key: string): boolean {
    this.expires.delete(key);
    return this.values.delete(key);
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

const buildEntry = (scope: UndoScope, index: number): UndoEntryInput & { groupId?: undefined } => ({
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

    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(reservation?.entryCount).toBe(1);
    expect(
      (await store.readReservedEntry(scope, reservation!.token, 0))._unsafeUnwrap().requestId
    ).toBe(entry2.requestId);
    (await store.abort(scope, reservation!.token))._unsafeUnwrap();

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
    const largeEntry: UndoEntryInput = {
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
        value !== null && typeof value === 'object' && 'format' in value
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
    await store.append(scope, {
      ...buildEntry(scope, 2),
      groupId: 'grp-1',
      groupPosition: 'start',
    });
    await store.append(scope, {
      ...buildEntry(scope, 3),
      groupId: 'grp-1',
      groupPosition: 'continue',
    });

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
    class DenyingRedis extends FakeRedis {
      override async set() {
        this.setCalls += 1;
        return null;
      }
    }
    const redis = new DenyingRedis();
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

  it('checkpoints progress and extends the lease before allowing takeover of the same group', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    for (const index of [1, 2]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;

    now = 15_999;
    (await store.markProgress(scope, first.token, 1))._unsafeUnwrap();
    now = 16_001;
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.reservation_conflict'
    );

    now = 31_000;
    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(taken.token).not.toBe(first.token);
    expect(taken.operationId).toBe(first.operationId);
    expect(taken.mode).toBe('undo');
    expect(taken.executionStatus).toBe('reserved');
    expect(taken.executedLeafIndex).toBe(1);
    expect(taken.entryCount).toBe(2);
    expect((await store.readReservedEntry(scope, first.token, 0))._unsafeUnwrapErr().code).toBe(
      'undo_redo.reservation_conflict'
    );
    expect(
      (await store.readReservedEntry(scope, taken.token, 1))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 1).undoCommand);
  });

  it('does not extend the current lease or overwrite progress when a stale token checkpoints', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    for (const index of [1, 2, 3]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    (await store.markProgress(scope, first.token, 1))._unsafeUnwrap();

    now = 16_001;
    const current = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(current.token).not.toBe(first.token);
    (await store.markProgress(scope, current.token, 2))._unsafeUnwrap();

    now = 31_000;
    expect((await store.markProgress(scope, first.token, 0))._unsafeUnwrapErr().code).toBe(
      'undo_redo.reservation_conflict'
    );
    now = 31_002;
    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(taken.token).not.toBe(current.token);
    expect(taken.token).not.toBe(first.token);
    expect(taken.operationId).toBe(first.operationId);
    expect(taken.executedLeafIndex).toBe(2);
    expect(taken.entryCount).toBe(3);
    expect(
      (await store.readReservedEntry(scope, taken.token, 2))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 1).undoCommand);
  });

  it('keeps stored progress and lease unchanged when checkpoint persistence fails before writing', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, {
      now: () => now,
      leaseMs: 15_000,
      compressionThresholdBytes: Infinity,
    });
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();
    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    const metaKey = [...keyv.values.keys()].find((key) => !key.includes(':entry:'))!;
    const storedBefore = keyv.values.get(metaKey);
    const set = keyv.set.bind(keyv);
    keyv.set = async (key, value, ttlMs) => {
      if (key === metaKey) throw new Error('metadata write failed');
      return set(key, value, ttlMs);
    };

    now = 15_999;
    await expect(store.markProgress(scope, first.token, 1)).rejects.toThrow(
      'metadata write failed'
    );
    expect(keyv.values.get(metaKey)).toBe(storedBefore);
    expect(keyv.values.get(metaKey)).toMatchObject({
      reservation: { token: first.token, executedLeafIndex: 0, leaseUntil: 16_000 },
    });

    keyv.set = set;
    now = 16_001;
    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(taken.token).not.toBe(first.token);
    expect(taken.operationId).toBe(first.operationId);
    expect(taken.executedLeafIndex).toBe(0);
    now = 31_000;
    (await store.markProgress(scope, taken.token, 1))._unsafeUnwrap();
    now = 31_002;
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.reservation_conflict'
    );
  });

  it('replays an interleaved group together without consuming the independent action', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();
    (
      await store.append(scope, {
        ...buildEntry(scope, 1),
        groupId: 'stream',
        groupPosition: 'start',
      })
    )._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, 2)))._unsafeUnwrap();
    (
      await store.append(scope, {
        ...buildEntry(scope, 3),
        groupId: 'stream',
        groupPosition: 'continue',
      })
    )._unsafeUnwrap();

    const undo = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(undo.entryCount).toBe(2);
    const latest = (await store.readReservedEntry(scope, undo.token, 0))._unsafeUnwrap();
    const earliest = (await store.readReservedEntry(scope, undo.token, 1))._unsafeUnwrap();
    expect(latest.undoCommand).toEqual(buildEntry(scope, 3).undoCommand);
    expect(earliest.undoCommand).toEqual(buildEntry(scope, 1).undoCommand);
    (await store.commit(scope, undo.token))._unsafeUnwrap();

    const redo = (await store.reserve(scope, 'redo'))._unsafeUnwrap()!;
    expect(
      (await store.readReservedEntry(scope, redo.token, 0))._unsafeUnwrap().redoCommand
    ).toEqual(buildEntry(scope, 1).redoCommand);
    expect(
      (await store.readReservedEntry(scope, redo.token, 1))._unsafeUnwrap().redoCommand
    ).toEqual(buildEntry(scope, 3).redoCommand);
    (await store.commit(scope, redo.token))._unsafeUnwrap();
    (await store.undo(scope))._unsafeUnwrap();
    expect((await store.undo(scope))._unsafeUnwrap()?.undoCommand).toEqual(
      buildEntry(scope, 2).undoCommand
    );
  });

  it('counts a multi-chunk group as one logical operation under maxEntries', async () => {
    const store = new KeyvUndoRedoStore(new Keyv(), { maxEntries: 3 });
    const scope = buildScope();
    // Edit 1 -> 24-chunk stream delete (1 logical group) -> Edit 2
    // Total logical groups = 3 <= maxEntries, so none should be evicted.
    (await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrap();
    for (let index = 2; index <= 25; index += 1) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 2 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    (await store.append(scope, buildEntry(scope, 26)))._unsafeUnwrap();

    // First undo reverts Edit 2
    const edit2 = (await store.undo(scope))._unsafeUnwrap();
    expect(edit2?.undoCommand).toEqual(buildEntry(scope, 26).undoCommand);

    // Second undo reserves and replays all 24 chunks of the stream delete
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(reservation.entryCount).toBe(24);
    expect(
      (await store.readReservedEntry(scope, reservation.token, 0))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 25).undoCommand);
    expect(
      (await store.readReservedEntry(scope, reservation.token, 23))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 2).undoCommand);
    (await store.commit(scope, reservation.token))._unsafeUnwrap();

    // Third undo reverts Edit 1
    const edit1 = (await store.undo(scope))._unsafeUnwrap();
    expect(edit1?.undoCommand).toEqual(buildEntry(scope, 1).undoCommand);
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrap()).toBeNull();
  });

  it('reserves and records replay progress without loading any window payloads', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    for (const index of [1, 2, 3]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    keyv.resetGetCalls();
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(reservation.entryCount).toBe(3);
    expect(reservation).not.toHaveProperty('entry');
    (await store.markProgress(scope, reservation.token, 1))._unsafeUnwrap();
    expect(keyv.getCalls.filter((key) => key.includes(':entry:'))).toHaveLength(0);
    const entry = (await store.readReservedEntry(scope, reservation.token, 1))._unsafeUnwrap();
    expect(entry.undoCommand).toEqual(buildEntry(scope, 2).undoCommand);
    expect(keyv.getCalls.filter((key) => key.includes(':entry:'))).toHaveLength(1);
  });

  it('keeps partial progress and the same group after aborting a replay', async () => {
    const store = new KeyvUndoRedoStore(new Keyv());
    const scope = buildScope();
    for (const index of [1, 2]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    (await store.markProgress(scope, first.token, 1))._unsafeUnwrap();
    (await store.abort(scope, first.token))._unsafeUnwrap();
    expect((await store.readReservedEntry(scope, first.token, 0))._unsafeUnwrapErr().code).toBe(
      'undo_redo.reservation_conflict'
    );
    const resumed = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(resumed.operationId).toBe(first.operationId);
    expect(resumed.executedLeafIndex).toBe(1);
    expect(resumed.entryCount).toBe(2);
    expect(
      (await store.readReservedEntry(scope, resumed.token, 1))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 1).undoCommand);
    for (const index of [-1, 2, 0.5]) {
      expect(
        (await store.readReservedEntry(scope, resumed.token, index))._unsafeUnwrapErr().code
      ).toBe('undo_redo.reservation_conflict');
    }
    expect((await store.readReservedEntry(scope, 'wrong-token', 0))._unsafeUnwrapErr().code).toBe(
      'undo_redo.reservation_conflict'
    );
  });

  it('does not skip a missing blob in a reserved group or advance its cursor', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    for (const index of [1, 2, 3]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    const missingKey = [...keyv.values.keys()].find((key) => key.endsWith(':entry:2'))!;
    const saved = keyv.values.get(missingKey);
    keyv.values.delete(missingKey);
    expect(
      (await store.readReservedEntry(scope, reservation.token, 1))._unsafeUnwrapErr().code
    ).toBe('undo_redo.entry_missing');
    (await store.abort(scope, reservation.token))._unsafeUnwrap();
    keyv.values.set(missingKey, saved);
    const retry = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(retry.entryCount).toBe(3);
    expect(
      (await store.readReservedEntry(scope, retry.token, 1))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 2).undoCommand);
  });

  it('expires a complete group without pinning it or accepting a late suffix', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 1_000 });
    const scope = buildScope();
    (
      await store.append(scope, {
        ...buildEntry(scope, 1),
        groupId: 'stream',
        groupPosition: 'start',
      })
    )._unsafeUnwrap();
    now = 1_500;
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    await keyv.set(
      scopeKey,
      {
        format: 'split-v1',
        entryIds: ['1'],
        cursor: 1,
        nextSequence: 2,
      },
      1_000
    );
    (
      await store.append(scope, {
        ...buildEntry(scope, 2),
        groupId: 'stream',
        groupPosition: 'continue',
      })
    )._unsafeUnwrap();
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    now = 2_001;
    expect(
      (await store.readReservedEntry(scope, reservation.token, 0))._unsafeUnwrapErr().code
    ).toBe('undo_redo.entry_missing');
    (await store.abort(scope, reservation.token))._unsafeUnwrap();
    expect(
      (
        await store.append(scope, {
          ...buildEntry(scope, 3),
          groupId: 'stream',
          groupPosition: 'continue',
        })
      )._unsafeUnwrapErr().code
    ).toBe('undo_redo.group_unavailable');
  });

  it('classifies old split history without rewriting blobs or extending their deadlines', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    await keyv.set(
      scopeKey,
      { format: 'split-v1', entryIds: ['1', '2'], cursor: 2, nextSequence: 3 },
      1_000
    );
    for (const index of [1, 2]) {
      const { scope: _scope, ...entry } = { ...buildEntry(scope, index), groupId: 'stream' };
      await keyv.set(`${scopeKey}:entry:${index}`, entry, 1_000);
    }
    const oldBlob = keyv.values.get(`${scopeKey}:entry:1`);
    keyv.setCalls.length = 0;
    now = 1_500;
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(reservation.entryCount).toBe(2);
    expect(keyv.setCalls.every((key) => !key.includes(':entry:'))).toBe(true);
    expect(keyv.values.get(`${scopeKey}:entry:1`)).toBe(oldBlob);
    expect(keyv.expires.get(`${scopeKey}:entry:1`)).toBe(2_000);
    now = 2_001;
    expect(
      (await store.readReservedEntry(scope, reservation.token, 1))._unsafeUnwrapErr().code
    ).toBe('undo_redo.entry_missing');
  });

  it('migrates inline history with its original expiry rather than a fresh retention window', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    const entries = [1, 2].map((index) => {
      const { scope: _scope, ...entry } = { ...buildEntry(scope, index), groupId: 'stream' };
      return entry;
    });
    await keyv.set(scopeKey, { entries, cursor: 2 }, 1_000);
    now = 1_500;
    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(reservation.entryCount).toBe(2);
    expect(
      (await store.readReservedEntry(scope, reservation.token, 0))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 2).undoCommand);
    now = 2_001;
    expect(
      (await store.readReservedEntry(scope, reservation.token, 1))._unsafeUnwrapErr().code
    ).toBe('undo_redo.entry_missing');
  });

  it('evicts an older group completely instead of keeping its last chunk', async () => {
    const store = new KeyvUndoRedoStore(new Keyv(), { maxEntries: 2 });
    const scope = buildScope();
    for (const index of [1, 2]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    (await store.append(scope, buildEntry(scope, 3)))._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, 4)))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap().map((entry) => entry.requestId)).toEqual([
      'req-3',
      'req-4',
    ]);
    expect((await store.undo(scope))._unsafeUnwrap()?.undoCommand).toEqual(
      buildEntry(scope, 4).undoCommand
    );
    expect((await store.undo(scope))._unsafeUnwrap()?.undoCommand).toEqual(
      buildEntry(scope, 3).undoCommand
    );
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrap()).toBeNull();
  });

  it('preserves original entry cursor semantics across an old writer dropping the group cache', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    for (const index of [1, 2, 3, 4]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: index <= 2 ? 'prior' : 'latest',
          groupPosition: index === 1 || index === 3 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    const undo = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(undo.entryCount).toBe(2);
    (await store.commit(scope, undo.token))._unsafeUnwrap();

    // The old writer consumes only these original split-v1 fields. Its append
    // truncates redo history and publishes metadata without the optional cache.
    const oldMeta = (await keyv.get(scopeKey)) as {
      format: string;
      entryIds: string[];
      cursor: number;
      nextSequence: number;
      revision: number;
    };
    expect(oldMeta.format).toBe('split-v1');
    expect(oldMeta.cursor).toBe(2);
    const keptIds = oldMeta.entryIds.slice(0, oldMeta.cursor);
    for (const entryId of oldMeta.entryIds.slice(oldMeta.cursor)) {
      await keyv.delete(`${scopeKey}:entry:${entryId}`);
    }
    const { scope: _scope, ...legacyAppend } = buildEntry(scope, 5);
    const legacyId = String(oldMeta.nextSequence);
    await keyv.set(`${scopeKey}:entry:${legacyId}`, legacyAppend);
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: [...keptIds, legacyId],
      cursor: keptIds.length + 1,
      nextSequence: oldMeta.nextSequence + 1,
      revision: oldMeta.revision + 1,
    });

    const nextProcess = new KeyvUndoRedoStore(keyv);
    expect((await nextProcess.undo(scope))._unsafeUnwrap()?.undoCommand).toEqual(
      buildEntry(scope, 5).undoCommand
    );
    const prior = (await nextProcess.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(prior.entryCount).toBe(2);
    expect(
      (await nextProcess.readReservedEntry(scope, prior.token, 0))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 2).undoCommand);
    expect(
      (await nextProcess.readReservedEntry(scope, prior.token, 1))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 1).undoCommand);
  });

  it('accepts a fresh append after an old split history loses an expired independent payload', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;

    const { scope: _scopeA, ...entryA } = buildEntry(scope, 1);
    const { scope: _scopeB, ...entryB } = buildEntry(scope, 2);
    await keyv.set(
      scopeKey,
      { format: 'split-v1', entryIds: ['1', '2'], cursor: 2, nextSequence: 3 },
      10_000
    );
    await keyv.set(`${scopeKey}:entry:1`, entryA, 500);
    await keyv.set(`${scopeKey}:entry:2`, entryB, 10_000);

    now = 2_000;
    const appended = await store.append(scope, buildEntry(scope, 3));
    expect(appended.isOk()).toBe(true);
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-3');
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-2');
  });

  it('fails closed when cacheless interleaved grouped history is missing a selected chunk', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;

    for (const index of [1, 2, 3]) {
      const { scope: _scope, ...entry } = {
        ...buildEntry(scope, index),
        ...(index !== 2 ? { groupId: 'stream' } : {}),
      };
      await keyv.set(`${scopeKey}:entry:${index}`, entry);
    }
    // An old writer publishes its original chronological entry list without
    // the optional group cache. The missing payload cannot reveal its group.
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: ['1', '2', '3'],
      cursor: 3,
      nextSequence: 4,
    });
    const missingKey = `${scopeKey}:entry:1`;
    const saved = keyv.values.get(missingKey);
    keyv.values.delete(missingKey);

    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.entry_missing'
    );
    keyv.values.set(missingKey, saved);
    const retry = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(retry.entryCount).toBe(2);
    expect((await store.readReservedEntry(scope, retry.token, 0))._unsafeUnwrap().requestId).toBe(
      'req-3'
    );
    expect((await store.readReservedEntry(scope, retry.token, 1))._unsafeUnwrap().requestId).toBe(
      'req-1'
    );
  });

  it('accepts a fresh independent append when cacheless history has an expired unknown payload and healthy grouped entries', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;

    for (const index of [1, 2, 3]) {
      const { scope: _scope, ...entry } = {
        ...buildEntry(scope, index),
        ...(index > 1 ? { groupId: 'stream' } : {}),
      };
      await keyv.set(`${scopeKey}:entry:${index}`, entry, index === 1 ? 500 : 10_000);
    }
    await keyv.set(
      scopeKey,
      { format: 'split-v1', entryIds: ['1', '2', '3'], cursor: 3, nextSequence: 4 },
      10_000
    );

    now = 2_000;
    expect((await store.append(scope, buildEntry(scope, 4))).isOk()).toBe(true);
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-4');
  });

  it('records and completely undoes a fresh group after a cacheless legacy gap beside healthy grouped history', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;

    for (const index of [1, 2, 3]) {
      const { scope: _scope, ...entry } = {
        ...buildEntry(scope, index),
        ...(index > 1 ? { groupId: 'legacy-stream' } : {}),
      };
      await keyv.set(`${scopeKey}:entry:${index}`, entry, index === 1 ? 500 : 10_000);
    }
    await keyv.set(
      scopeKey,
      { format: 'split-v1', entryIds: ['1', '2', '3'], cursor: 3, nextSequence: 4 },
      10_000
    );

    now = 2_000;
    for (const index of [4, 5]) {
      expect(
        (
          await store.append(scope, {
            ...buildEntry(scope, index),
            groupId: 'fresh-stream',
            groupPosition: index === 4 ? 'start' : 'continue',
          })
        ).isOk()
      ).toBe(true);
    }
    // An old process drops the optional cache again after the new group was
    // recorded. Fresh-group replay must survive without guessing the old gap.
    const metadata = (await keyv.get(scopeKey)) as {
      entryIds: string[];
      cursor: number;
      nextSequence: number;
      revision: number;
    };
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: metadata.entryIds,
      cursor: metadata.cursor,
      nextSequence: metadata.nextSequence,
      revision: metadata.revision,
    });
    const undo = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(undo.entryCount).toBe(2);
    expect(
      (await store.readReservedEntry(scope, undo.token, 0))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 5).undoCommand);
    expect(
      (await store.readReservedEntry(scope, undo.token, 1))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 4).undoCommand);
    (await store.commit(scope, undo.token))._unsafeUnwrap();

    const redo = (await store.reserve(scope, 'redo'))._unsafeUnwrap()!;
    expect(redo.entryCount).toBe(2);
    expect(
      (await store.readReservedEntry(scope, redo.token, 0))._unsafeUnwrap().redoCommand
    ).toEqual(buildEntry(scope, 4).redoCommand);
    expect(
      (await store.readReservedEntry(scope, redo.token, 1))._unsafeUnwrap().redoCommand
    ).toEqual(buildEntry(scope, 5).redoCommand);
    (await store.commit(scope, redo.token))._unsafeUnwrap();
  });

  it('rejects a continuation whose established start is missing after the group cache is dropped', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    for (const index of [1, 2]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: index === 1 ? 'start' : 'continue',
        })
      )._unsafeUnwrap();
    }
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: ['1', '2'],
      cursor: 2,
      nextSequence: 3,
    });
    const firstKey = `${scopeKey}:entry:1`;
    const first = keyv.values.get(firstKey);
    await keyv.delete(firstKey);
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.entry_missing'
    );
    expect(
      (
        await store.append(scope, {
          ...buildEntry(scope, 3),
          groupId: 'stream',
          groupPosition: 'continue',
        })
      )._unsafeUnwrapErr().code
    ).toBe('undo_redo.group_unavailable');

    await keyv.set(firstKey, first);
    const retry = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(retry.entryCount).toBe(2);
    expect((await store.readReservedEntry(scope, retry.token, 0))._unsafeUnwrap().requestId).toBe(
      'req-2'
    );
    expect((await store.readReservedEntry(scope, retry.token, 1))._unsafeUnwrap().requestId).toBe(
      'req-1'
    );
  });

  it('fails closed on a missing interior fresh-group chunk after interleaving and cache loss', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv);
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    (
      await store.append(scope, {
        ...buildEntry(scope, 1),
        groupId: 'stream',
        groupPosition: 'start',
      })
    )._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, 2)))._unsafeUnwrap();
    for (const index of [3, 4]) {
      (
        await store.append(scope, {
          ...buildEntry(scope, index),
          groupId: 'stream',
          groupPosition: 'continue',
        })
      )._unsafeUnwrap();
    }
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: ['1', '2', '3', '4'],
      cursor: 4,
      nextSequence: 5,
    });
    const missingKey = `${scopeKey}:entry:3`;
    const saved = keyv.values.get(missingKey);
    await keyv.delete(missingKey);
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.entry_missing'
    );
    await keyv.set(missingKey, saved);
    const retry = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(retry.entryCount).toBe(3);
    for (const [offset, index] of [4, 3, 1].entries()) {
      expect(
        (await store.readReservedEntry(scope, retry.token, offset))._unsafeUnwrap().undoCommand
      ).toEqual(buildEntry(scope, index).undoCommand);
    }
    (await store.commit(scope, retry.token))._unsafeUnwrap();
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-2');
  });

  it('does not extend an uncertain legacy prefix lifetime when fresh recording refreshes metadata', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    const { scope: _scopeA, ...entryA } = buildEntry(scope, 1);
    const { scope: _scopeB, ...entryB } = { ...buildEntry(scope, 2), groupId: 'legacy-stream' };
    await keyv.set(`${scopeKey}:entry:1`, entryA, 500);
    // This payload outlives its original metadata; migration must not revive
    // the old logical history merely because the payload is still present.
    await keyv.set(`${scopeKey}:entry:2`, entryB);
    await keyv.set(
      scopeKey,
      {
        format: 'split-v1',
        entryIds: ['1', '2'],
        cursor: 2,
        nextSequence: 3,
      },
      10_000
    );
    now = 2_000;
    (await store.append(scope, buildEntry(scope, 3)))._unsafeUnwrap();
    now = 11_001;
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-3');
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrap()).toBeNull();
  });

  it('retains an uncertain legacy prefix beyond maxEntries without dropping valid independent history', async () => {
    let now = 1_000;
    const keyv = new MemoryKeyv(() => now);
    const store = new KeyvUndoRedoStore(keyv, { now: () => now, ttlMs: 10_000, maxEntries: 1 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    for (const index of [1, 2]) {
      const { scope: _scope, ...entry } = buildEntry(scope, index);
      await keyv.set(`${scopeKey}:entry:${index}`, entry, index === 1 ? 500 : 10_000);
    }
    await keyv.set(
      scopeKey,
      {
        format: 'split-v1',
        entryIds: ['1', '2'],
        cursor: 2,
        nextSequence: 3,
      },
      10_000
    );
    now = 2_000;
    (await store.append(scope, buildEntry(scope, 3)))._unsafeUnwrap();
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-3');
    expect((await store.undo(scope))._unsafeUnwrap()?.requestId).toBe('req-2');
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.entry_missing'
    );
  });

  it('rejects oversized cacheless metadata before reading any history payloads', async () => {
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv, { maxEntries: 1 });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    const count = 32_769;
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: Array.from({ length: count }, (_, index) => String(index + 1)),
      cursor: count,
      nextSequence: count + 1,
    });
    keyv.resetGetCalls();
    expect((await store.append(scope, buildEntry(scope, 1)))._unsafeUnwrapErr().code).toBe(
      'undo_redo.capacity_exceeded'
    );
    expect((await store.reserve(scope, 'undo'))._unsafeUnwrapErr().code).toBe(
      'undo_redo.capacity_exceeded'
    );
    expect(keyv.getCalls.filter((key) => key.includes(':entry:'))).toHaveLength(0);
  });

  it('accepts the fixed reference boundary then rejects a larger group without changing history', async () => {
    const referenceLimit = 32_768;
    const keyv = new MemoryKeyv();
    const store = new KeyvUndoRedoStore(keyv, { compressionThresholdBytes: Infinity });
    const scope = buildScope();
    const scopeKey = `v2:undo-redo:${scope.actorId}:${scope.tableId}:${scope.windowId}`;
    // Seed only metadata and the payload endpoints this test reads, avoiding
    // thousands of unrelated record snapshots to exercise a reference budget.
    const { scope: _scope, ...firstEntry } = buildEntry(scope, 1);
    await keyv.set(`${scopeKey}:entry:1`, firstEntry);
    await keyv.set(scopeKey, {
      format: 'split-v1',
      entryIds: Array.from({ length: referenceLimit - 1 }, (_, index) => String(index + 1)),
      cursor: referenceLimit - 1,
      nextSequence: referenceLimit,
      revision: 1,
      groups: [
        {
          groupId: 'stream',
          groupStartSequence: 1,
          ranges: [{ startSequence: 1, endSequence: referenceLimit }],
        },
      ],
    });
    (
      await store.append(scope, {
        ...buildEntry(scope, 8),
        groupId: 'stream',
        groupPosition: 'continue',
      })
    )._unsafeUnwrap();
    const beforeFailure = keyv.values.get(scopeKey);
    keyv.setCalls.length = 0;
    const overflow = await store.append(scope, {
      ...buildEntry(scope, 9),
      groupId: 'stream',
      groupPosition: 'continue',
    });
    expect(overflow._unsafeUnwrapErr().code).toBe('undo_redo.capacity_exceeded');
    expect(keyv.setCalls).toHaveLength(0);
    expect(keyv.values.get(scopeKey)).toBe(beforeFailure);
    expect(keyv.values.has(`${scopeKey}:entry:${referenceLimit + 1}`)).toBe(false);

    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(reservation.entryCount).toBe(referenceLimit);
    expect(
      (await store.readReservedEntry(scope, reservation.token, 0))._unsafeUnwrap().undoCommand
    ).toEqual(buildEntry(scope, 8).undoCommand);
    expect(
      (await store.readReservedEntry(scope, reservation.token, referenceLimit - 1))._unsafeUnwrap()
        .undoCommand
    ).toEqual(buildEntry(scope, 1).undoCommand);
  });
});
