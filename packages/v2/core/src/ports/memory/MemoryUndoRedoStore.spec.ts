import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { TableId } from '../../domain/table/TableId';
import { createUndoRedoCommand, type UndoEntry, type UndoScope } from '../UndoRedoStore';

import { MemoryUndoRedoStore } from './MemoryUndoRedoStore';

const buildScope = (): UndoScope => {
  const actorId = ActorId.create('actor')._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  return { actorId, tableId, windowId: 'window-1' };
};

const buildEntry = (scope: UndoScope, recordId: string): Omit<UndoEntry, 'groupId'> => ({
  scope,
  undoCommand: createUndoRedoCommand('UpdateRecord', {
    tableId: scope.tableId.toString(),
    recordId,
    fields: { fld: 'old' },
    fieldKeyType: 'id',
    typecast: false,
  }),
  redoCommand: createUndoRedoCommand('UpdateRecord', {
    tableId: scope.tableId.toString(),
    recordId,
    fields: { fld: 'new' },
    fieldKeyType: 'id',
    typecast: false,
  }),
  recordVersionBefore: 1,
  recordVersionAfter: 2,
  createdAt: new Date().toISOString(),
});

describe('MemoryUndoRedoStore', () => {
  it('requires an established applied start and never stores recording intent', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();
    const entry = { ...buildEntry(scope, `rec${'1'.repeat(16)}`), groupId: 'stream' };
    expect(
      (await store.append(scope, { ...entry, groupPosition: 'continue' }))._unsafeUnwrapErr().code
    ).toBe('undo_redo.group_unavailable');
    expect((await store.list(scope))._unsafeUnwrap()).toEqual([]);
    (await store.append(scope, { ...entry, groupPosition: 'start' }))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap()).toEqual([entry]);
    expect((await store.append(scope, { ...entry, groupPosition: 'start' })).isErr()).toBe(true);
    (await store.undo(scope))._unsafeUnwrap();
    expect((await store.append(scope, { ...entry, groupPosition: 'continue' })).isErr()).toBe(true);
    const independent = buildEntry(scope, `rec${'2'.repeat(16)}`);
    (await store.append(scope, independent))._unsafeUnwrap();
    (await store.append(scope, { ...entry, groupPosition: 'start' }))._unsafeUnwrap();
    (await store.append(scope, { ...entry, groupPosition: 'continue' }))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap()).toEqual([independent, entry, entry]);
  });

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

  it('undos and redoes contiguous grouped entries as a single batch', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();

    const entry1 = { ...buildEntry(scope, `rec${'1'.repeat(16)}`), groupId: 'grp-1' };
    const entry2 = { ...buildEntry(scope, `rec${'2'.repeat(16)}`), groupId: 'grp-1' };

    (await store.append(scope, { ...entry1, groupPosition: 'start' }))._unsafeUnwrap();
    (await store.append(scope, { ...entry2, groupPosition: 'continue' }))._unsafeUnwrap();

    const reservation = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(reservation?.entryCount).toBe(2);
    expect(
      (await store.readReservedEntry(scope, reservation!.token, 0))._unsafeUnwrap().scope
    ).toEqual(scope);
    expect(
      (await store.readReservedEntry(scope, reservation!.token, 1))._unsafeUnwrap().scope
    ).toEqual(scope);
    (await store.abort(scope, reservation!.token))._unsafeUnwrap();

    const undoEntry = (await store.undo(scope))._unsafeUnwrap();
    expect(undoEntry?.undoCommand.type).toBe('Batch');
    expect(undoEntry?.redoCommand.type).toBe('Batch');
    expect(
      undoEntry?.undoCommand.type === 'Batch' ? undoEntry.undoCommand.payload : []
    ).toHaveLength(2);

    const redoEntry = (await store.redo(scope))._unsafeUnwrap();
    expect(redoEntry?.undoCommand.type).toBe('Batch');
    expect(redoEntry?.redoCommand.type).toBe('Batch');
    expect(
      redoEntry?.redoCommand.type === 'Batch' ? redoEntry.redoCommand.payload : []
    ).toHaveLength(2);
  });

  it('keeps both entries when two appends run concurrently', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();

    await Promise.all([
      store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)),
      store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`)),
    ]);

    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed).toHaveLength(2);
  });

  it('rejects append while an undo reservation is held', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)))._unsafeUnwrap();

    const reserved = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(reserved).not.toBeNull();

    const appendResult = await store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`));
    expect(appendResult.isErr()).toBe(true);
    expect(appendResult._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');

    (await store.abort(scope, reserved!.token))._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`)))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap()).toHaveLength(2);
  });

  it('lets a later undo take over after the reservation lease expires', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)))._unsafeUnwrap();

    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(first).not.toBeNull();

    const live = await store.reserve(scope, 'undo');
    expect(live.isErr()).toBe(true);
    expect(live._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');

    now = 16_001;
    const taken = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    expect(taken?.token).not.toBe(first!.token);
    expect(taken?.operationId).toBe(first!.operationId);
    expect(taken?.executionStatus).toBe('reserved');
  });

  it('renew extends a reservation past the original lease', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)))._unsafeUnwrap();

    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    now = 10_000;
    (await store.renew(scope, first!.token))._unsafeUnwrap();
    now = 20_000;
    const live = await store.reserve(scope, 'undo');
    expect(live.isErr()).toBe(true);
    expect(live._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');
  });

  it('rejects append when expectedRevision does not match', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)))._unsafeUnwrap();

    const stale = await store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`), 0);
    expect(stale.isErr()).toBe(true);
    expect(stale._unsafeUnwrapErr().code).toBe('undo_redo.revision_conflict');

    (await store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`), 1))._unsafeUnwrap();
    expect((await store.list(scope))._unsafeUnwrap()).toHaveLength(2);
  });

  it('does not carry executedLeafIndex into a different replay mode after lease expiry', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)))._unsafeUnwrap();
    (await store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`)))._unsafeUnwrap();

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
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();
    (await store.append(scope, buildEntry(scope, `rec${'1'.repeat(16)}`)))._unsafeUnwrap();

    const reserved = (await store.reserve(scope, 'undo'))._unsafeUnwrap();
    (await store.markSucceeded(scope, reserved!.token))._unsafeUnwrap();

    (await store.append(scope, buildEntry(scope, `rec${'2'.repeat(16)}`)))._unsafeUnwrap();
    const listed = (await store.list(scope))._unsafeUnwrap();
    expect(listed).toHaveLength(1);
    const undoCommand = listed[0]?.undoCommand;
    expect(undoCommand?.type).toBe('UpdateRecord');
    if (undoCommand?.type === 'UpdateRecord') {
      expect(undoCommand.payload.recordId).toBe(`rec${'2'.repeat(16)}`);
    }
  });

  it('checkpoints progress and extends the lease before preserving the group on takeover', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    const entries = ['1', '2'].map((digit) => ({
      ...buildEntry(scope, `rec${digit.repeat(16)}`),
      groupId: 'checkpoint-group',
    }));
    for (const [index, entry] of entries.entries()) {
      const groupPosition = index === 0 ? 'start' : 'continue';
      (await store.append(scope, { ...entry, groupPosition }))._unsafeUnwrap();
    }

    const first = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    now = 15_999;
    (await store.markProgress(scope, first.token, 1))._unsafeUnwrap();

    now = 16_001;
    const competing = await store.reserve(scope, 'undo');
    expect(competing._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');
    expect((await store.readReservedEntry(scope, first.token, 0))._unsafeUnwrap()).toEqual(
      entries[1]
    );

    now = 31_000;
    const takeover = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(takeover.token).not.toBe(first.token);
    expect(takeover.operationId).toBe(first.operationId);
    expect(takeover.executedLeafIndex).toBe(1);
    expect(takeover.mode).toBe('undo');
    expect(takeover.executionStatus).toBe('reserved');
    expect(takeover.entryCount).toBe(2);
    expect((await store.readReservedEntry(scope, takeover.token, 0))._unsafeUnwrap()).toEqual(
      entries[1]
    );
    expect((await store.readReservedEntry(scope, takeover.token, 1))._unsafeUnwrap()).toEqual(
      entries[0]
    );
    expect((await store.readReservedEntry(scope, first.token, 0)).isErr()).toBe(true);
  });

  it('does not extend the current lease or overwrite progress for a stale checkpoint token', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 15_000 });
    const scope = buildScope();
    const entry = buildEntry(scope, `rec${'1'.repeat(16)}`);
    (await store.append(scope, entry))._unsafeUnwrap();
    const original = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    (await store.markProgress(scope, original.token, 1))._unsafeUnwrap();

    now = 16_001;
    const current = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(current.token).not.toBe(original.token);
    expect(current.executedLeafIndex).toBe(1);

    now = 31_000;
    const rejected = await store.markProgress(scope, original.token, 2);
    expect(rejected._unsafeUnwrapErr().code).toBe('undo_redo.reservation_conflict');
    expect((await store.readReservedEntry(scope, current.token, 0))._unsafeUnwrap()).toEqual(entry);

    now = 31_002;
    const takeover = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(takeover.token).not.toBe(current.token);
    expect(takeover.token).not.toBe(original.token);
    expect(takeover.operationId).toBe(original.operationId);
    expect(takeover.executedLeafIndex).toBe(1);
    expect(takeover.entryCount).toBe(1);
    expect(takeover.executionStatus).toBe('reserved');
  });

  it('reads one reserved entry in replay order and keeps interleaved actions independent', async () => {
    const store = new MemoryUndoRedoStore();
    const scope = buildScope();
    const first = { ...buildEntry(scope, `rec${'1'.repeat(16)}`), groupId: 'stream' };
    const independent = buildEntry(scope, `rec${'2'.repeat(16)}`);
    const second = { ...buildEntry(scope, `rec${'3'.repeat(16)}`), groupId: 'stream' };
    (await store.append(scope, { ...first, groupPosition: 'start' }))._unsafeUnwrap();
    (await store.append(scope, independent))._unsafeUnwrap();
    (await store.append(scope, { ...second, groupPosition: 'continue' }))._unsafeUnwrap();
    const undo = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(undo.entryCount).toBe(2);
    expect(undo).not.toHaveProperty('entry');
    expect((await store.readReservedEntry(scope, undo.token, 0))._unsafeUnwrap()).toEqual(second);
    expect((await store.readReservedEntry(scope, undo.token, 1))._unsafeUnwrap()).toEqual(first);
    for (const index of [-1, 2, 0.5]) {
      expect((await store.readReservedEntry(scope, undo.token, index)).isErr()).toBe(true);
    }
    (await store.commit(scope, undo.token))._unsafeUnwrap();
    expect((await store.readReservedEntry(scope, undo.token, 0)).isErr()).toBe(true);
    const redo = (await store.reserve(scope, 'redo'))._unsafeUnwrap()!;
    expect((await store.readReservedEntry(scope, redo.token, 0))._unsafeUnwrap()).toEqual(first);
    expect((await store.readReservedEntry(scope, redo.token, 1))._unsafeUnwrap()).toEqual(second);
    (await store.abort(scope, redo.token))._unsafeUnwrap();
    expect((await store.undo(scope))._unsafeUnwrap()).toEqual(independent);
  });

  it('rejects stale reserved reads after takeover and retains partial group progress on abort', async () => {
    let now = 1_000;
    const store = new MemoryUndoRedoStore({ now: () => now, leaseMs: 100 });
    const scope = buildScope();
    const entry = buildEntry(scope, `rec${'1'.repeat(16)}`);
    (await store.append(scope, entry))._unsafeUnwrap();
    const original = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    (await store.markProgress(scope, original.token, 1))._unsafeUnwrap();
    (await store.abort(scope, original.token))._unsafeUnwrap();
    expect((await store.readReservedEntry(scope, original.token, 0)).isErr()).toBe(true);
    now = 1_101;
    const takeover = (await store.reserve(scope, 'undo'))._unsafeUnwrap()!;
    expect(takeover.executedLeafIndex).toBe(1);
    expect(takeover.operationId).toBe(original.operationId);
    expect((await store.readReservedEntry(scope, original.token, 0)).isErr()).toBe(true);
    expect((await store.readReservedEntry(scope, takeover.token, 0))._unsafeUnwrap()).toEqual(
      entry
    );
    (await store.markSucceeded(scope, takeover.token))._unsafeUnwrap();
    (await store.commit(scope, takeover.token))._unsafeUnwrap();
    expect((await store.undo(scope))._unsafeUnwrap()).toBeNull();
  });
});
