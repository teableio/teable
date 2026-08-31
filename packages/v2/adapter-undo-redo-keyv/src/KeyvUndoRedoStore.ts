import { brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import type Keyv from 'keyv';
import { err, ok } from 'neverthrow';

import type {
  IUndoRedoStore,
  UndoEntry,
  UndoRedoListOptions,
  UndoRedoCommandData,
  UndoRedoReplayMode,
  UndoRedoReservation,
  UndoScope,
} from '@teable/v2-core';
import { composeUndoRedoCommands, domainError, flattenUndoRedoCommands } from '@teable/v2-core';

type StoredUndoEntry = Omit<UndoEntry, 'scope'>;

type LegacyUndoRedoState = {
  entries: StoredUndoEntry[];
  cursor: number;
};

type StoredReservation = {
  token: string;
  mode: UndoRedoReplayMode;
  cursorAfterCommit: number;
  operationId: string;
  executionStatus: 'reserved' | 'succeeded';
  leaseUntil: number;
  executedLeafIndex: number;
  inFlight: boolean;
};

type RedisLockClient = {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  get?(key: string): Promise<unknown>;
  eval?(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
};

const isRedisLockClient = (value: unknown): value is RedisLockClient => {
  if (!value || typeof value !== 'object') return false;
  if (!('set' in value) || !('del' in value)) return false;
  return typeof value.set === 'function' && typeof value.del === 'function';
};

type SplitUndoRedoState = {
  format: 'split-v1';
  entryIds: string[];
  cursor: number;
  nextSequence: number;
  revision?: number;
  reservation?: StoredReservation;
};

type CompressedValue =
  | {
      format: 'br64-json';
      data: string;
    }
  | {
      format: 'gz64-json';
      data: string;
    };

type LoadedState = {
  format: 'empty' | 'inline' | 'split';
  entryIds: string[];
  entries: StoredUndoEntry[];
  cursor: number;
  nextSequence: number;
  revision: number;
  reservation?: StoredReservation;
};

const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 16 * 1024;
const LOCK_TTL_SECONDS = 15;
const LOCK_EXTEND_INTERVAL_MS = 5_000;
const DEFAULT_LOCK_ATTEMPTS = 50;
const DEFAULT_LOCK_RETRY_DELAY_MS = 300;
const RELEASE_LOCK_LUA =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';
const EXTEND_LOCK_LUA =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("EXPIRE", KEYS[1], ARGV[2]) else return 0 end';

// Same executor form as @teable/v2-adapter-db-postgres-shared/unitOfWork —
// Promise.withResolvers is not in this package's TS lib target.
const sleep = (ms: number): Promise<void> => {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};
export interface KeyvUndoRedoStoreOptions {
  keyPrefix?: string;
  ttlMs?: number;
  maxEntries?: number;
  compressionThresholdBytes?: number;
  now?: () => number;
  leaseMs?: number;
  lockAttempts?: number;
  lockRetryDelayMs?: number;
}

const isLegacyUndoRedoState = (value: unknown): value is LegacyUndoRedoState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LegacyUndoRedoState>;
  return Array.isArray(candidate.entries) && typeof candidate.cursor === 'number';
};

const isSplitUndoRedoState = (value: unknown): value is SplitUndoRedoState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SplitUndoRedoState>;
  return (
    candidate.format === 'split-v1' &&
    Array.isArray(candidate.entryIds) &&
    typeof candidate.cursor === 'number' &&
    typeof candidate.nextSequence === 'number'
  );
};

const isCompressedValue = (value: unknown): value is CompressedValue => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CompressedValue>;
  return (
    (candidate.format === 'br64-json' || candidate.format === 'gz64-json') &&
    typeof candidate.data === 'string'
  );
};

const isUndoRedoCommandData = (value: unknown): value is UndoRedoCommandData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UndoRedoCommandData>;
  return typeof candidate.type === 'string' && typeof candidate.version === 'number';
};

const isStoredUndoEntry = (value: unknown): value is StoredUndoEntry => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredUndoEntry>;
  return (
    typeof candidate.createdAt === 'string' &&
    isUndoRedoCommandData(candidate.undoCommand) &&
    isUndoRedoCommandData(candidate.redoCommand)
  );
};

const isStoredReservation = (value: unknown): value is StoredReservation => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredReservation>;
  return (
    typeof candidate.token === 'string' &&
    (candidate.mode === 'undo' || candidate.mode === 'redo') &&
    typeof candidate.cursorAfterCommit === 'number'
  );
};

const toStoredReservation = (value: StoredReservation): StoredReservation => ({
  token: value.token,
  mode: value.mode,
  cursorAfterCommit: value.cursorAfterCommit,
  operationId: value.operationId || value.token,
  executionStatus: value.executionStatus === 'succeeded' ? 'succeeded' : 'reserved',
  leaseUntil:
    typeof value.leaseUntil === 'number' && Number.isFinite(value.leaseUntil)
      ? value.leaseUntil
      : 0,
  executedLeafIndex: typeof value.executedLeafIndex === 'number' ? value.executedLeafIndex : 0,
  inFlight: value.inFlight !== false,
});

export class KeyvUndoRedoStore implements IUndoRedoStore {
  private readonly keyPrefix: string;
  private readonly ttlMs?: number;
  private readonly maxEntries?: number;
  private readonly compressionThresholdBytes: number;
  private readonly scopeTail = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly lockAttempts: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    private readonly keyv: Pick<Keyv, 'get' | 'set' | 'delete'>,
    options?: KeyvUndoRedoStoreOptions
  ) {
    this.keyPrefix = options?.keyPrefix ?? 'v2:undo-redo';
    this.ttlMs = options?.ttlMs;
    this.maxEntries = options?.maxEntries;
    this.compressionThresholdBytes =
      options?.compressionThresholdBytes ?? DEFAULT_COMPRESSION_THRESHOLD_BYTES;
    this.now = options?.now ?? Date.now;
    this.leaseMs = options?.leaseMs ?? 15_000;
    this.lockAttempts = options?.lockAttempts ?? DEFAULT_LOCK_ATTEMPTS;
    this.lockRetryDelayMs = options?.lockRetryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS;
  }

  async append(scope: UndoScope, entry: UndoEntry, expectedRevision?: number) {
    return this.enqueueScope(scope, () => this.appendUnlocked(scope, entry, expectedRevision));
  }

  private async appendUnlocked(scope: UndoScope, entry: UndoEntry, expectedRevision?: number) {
    const strippedEntry = this.stripScope(entry);
    const meta = await this.readPersistedValue(this.scopeKey(scope));
    if (isSplitUndoRedoState(meta)) {
      const healed = this.commitSucceededMeta(meta);
      if (this.isLiveReservation(healed.reservation)) {
        return err(
          domainError.conflict({
            code: 'undo_redo.reservation_conflict',
            message: 'Undo/redo reservation already held for this window',
          })
        );
      }
      const revision = healed.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        return err(
          domainError.conflict({
            code: 'undo_redo.revision_conflict',
            message: 'Undo/redo stack revision does not match',
          })
        );
      }
      return this.appendSplitEntry(scope, strippedEntry, { ...healed, revision });
    }

    const state = await this.loadState(scope);
    this.commitSucceededLoaded(state);
    if (this.isLiveReservation(state.reservation)) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation already held for this window',
        })
      );
    }
    if (expectedRevision !== undefined && expectedRevision !== state.revision) {
      return err(
        domainError.conflict({
          code: 'undo_redo.revision_conflict',
          message: 'Undo/redo stack revision does not match',
        })
      );
    }
    const keptEntries =
      state.cursor < state.entries.length
        ? state.entries.slice(0, state.cursor)
        : [...state.entries];
    const keptEntryIds =
      state.cursor < state.entryIds.length
        ? state.entryIds.slice(0, state.cursor)
        : [...state.entryIds];

    let nextSequence = Math.max(
      state.nextSequence,
      keptEntryIds.reduce((max, entryId) => Math.max(max, Number(entryId) || 0), 0) + 1
    );

    const nextEntryId = String(nextSequence++);
    keptEntries.push(strippedEntry);
    keptEntryIds.push(nextEntryId);

    let limitedEntries = keptEntries;
    let limitedEntryIds = keptEntryIds;
    let cursor = keptEntries.length;

    if (this.maxEntries && this.maxEntries > 0 && keptEntries.length > this.maxEntries) {
      const droppedCount = keptEntries.length - this.maxEntries;
      limitedEntries = keptEntries.slice(droppedCount);
      limitedEntryIds = keptEntryIds.slice(droppedCount);
      cursor = limitedEntries.length;
    }

    await this.persistAllEntries(scope, limitedEntryIds, limitedEntries);
    await this.persistMeta(scope, {
      format: 'split-v1',
      entryIds: limitedEntryIds,
      cursor,
      nextSequence,
      revision: state.revision + 1,
    });

    return ok(undefined);
  }

  async undo(scope: UndoScope) {
    return this.reserveAndCommit(scope, 'undo');
  }

  async redo(scope: UndoScope) {
    return this.reserveAndCommit(scope, 'redo');
  }

  async list(scope: UndoScope, options?: UndoRedoListOptions) {
    const state = await this.loadState(scope);
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    const end = limit === undefined ? state.entries.length : offset + Math.max(0, limit);
    return ok(state.entries.slice(offset, end).map((entry) => this.attachScope(scope, entry)));
  }

  async reserve(scope: UndoScope, mode: UndoRedoReplayMode) {
    return this.enqueueScope(scope, () => this.reserveUnlocked(scope, mode));
  }

  private async reserveUnlocked(scope: UndoScope, mode: UndoRedoReplayMode) {
    const state = await this.loadState(scope);
    if (state.reservation?.executionStatus === 'succeeded') {
      if (state.reservation.mode === mode) {
        return ok(this.toPublicReservation(scope, state, state.reservation));
      }
      this.commitSucceededLoaded(state);
    }
    if (this.isLiveReservation(state.reservation) && state.reservation?.inFlight) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation already held for this window',
        })
      );
    }
    if (
      this.isLiveReservation(state.reservation) &&
      state.reservation &&
      !state.reservation.inFlight
    ) {
      if (state.reservation.mode !== mode) {
        return err(
          domainError.conflict({
            code: 'undo_redo.reservation_conflict',
            message: 'Undo/redo reservation already held for this window',
          })
        );
      }
      const reservation = { ...state.reservation, inFlight: true };
      await this.persistReservation(scope, state, reservation);
      return ok(this.toPublicReservation(scope, state, reservation));
    }

    if (mode === 'undo') {
      if (state.cursor <= 0) {
        return ok(null);
      }
      const group = this.resolveUndoGroup(state.entries, state.cursor - 1);
      const takeover = this.reservationTakeover(state.reservation, mode);
      const reservation = this.createReservation(
        mode,
        group.startIndex,
        takeover.operationId,
        takeover.executedLeafIndex
      );
      await this.persistReservation(scope, state, reservation);
      return ok(this.toPublicReservation(scope, state, reservation));
    }

    if (state.cursor >= state.entries.length) {
      return ok(null);
    }
    const group = this.resolveRedoGroup(state.entries, state.cursor);
    const takeover = this.reservationTakeover(state.reservation, mode);
    const reservation = this.createReservation(
      mode,
      group.endIndex,
      takeover.operationId,
      takeover.executedLeafIndex
    );
    await this.persistReservation(scope, state, reservation);
    return ok(this.toPublicReservation(scope, state, reservation));
  }

  async markSucceeded(scope: UndoScope, token: string) {
    return this.enqueueScope(scope, () => this.markSucceededUnlocked(scope, token));
  }

  async markProgress(scope: UndoScope, token: string, executedLeafIndex: number) {
    return this.enqueueScope(scope, () =>
      this.markProgressUnlocked(scope, token, executedLeafIndex)
    );
  }

  private async markProgressUnlocked(
    scope: UndoScope,
    token: string,
    executedLeafIndex: number
  ) {
    const state = await this.loadState(scope);
    if (!state.reservation || state.reservation.token !== token) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation token does not match',
        })
      );
    }
    await this.persistReservation(scope, state, {
      ...state.reservation,
      executedLeafIndex,
    });
    return ok(undefined);
  }

  async renew(scope: UndoScope, token: string) {
    return this.enqueueScope(scope, () => this.renewUnlocked(scope, token));
  }

  private async renewUnlocked(scope: UndoScope, token: string) {
    const state = await this.loadState(scope);
    if (!state.reservation || state.reservation.token !== token) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation token does not match',
        })
      );
    }
    await this.persistReservation(scope, state, {
      ...state.reservation,
      leaseUntil: this.now() + this.leaseMs,
    });
    return ok(undefined);
  }

  private async markSucceededUnlocked(scope: UndoScope, token: string) {
    const state = await this.loadState(scope);
    if (!state.reservation || state.reservation.token !== token) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation token does not match',
        })
      );
    }
    await this.persistReservation(scope, state, {
      ...state.reservation,
      executionStatus: 'succeeded',
    });
    return ok(undefined);
  }

  async commit(scope: UndoScope, token: string) {
    return this.enqueueScope(scope, () => this.commitUnlocked(scope, token));
  }

  private async commitUnlocked(scope: UndoScope, token: string) {
    const state = await this.loadState(scope);
    if (!state.reservation || state.reservation.token !== token) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation token does not match',
        })
      );
    }
    await this.persistAfterCursorChange(scope, state, state.reservation.cursorAfterCommit);
    return ok(undefined);
  }

  async abort(scope: UndoScope, token: string) {
    return this.enqueueScope(scope, () => this.abortUnlocked(scope, token));
  }

  private async abortUnlocked(scope: UndoScope, token: string) {
    const state = await this.loadState(scope);
    if (!state.reservation) {
      return ok(undefined);
    }
    if (state.reservation.token !== token) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation token does not match',
        })
      );
    }
    if (state.reservation.executionStatus === 'succeeded') {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Succeeded undo/redo reservation cannot be aborted',
        })
      );
    }
    if (state.reservation.executedLeafIndex > 0) {
      await this.persistReservation(scope, state, {
        ...state.reservation,
        inFlight: false,
      });
      return ok(undefined);
    }
    await this.persistReservation(scope, state, undefined);
    return ok(undefined);
  }

  private toPublicReservation(
    scope: UndoScope,
    state: LoadedState,
    reservation: StoredReservation
  ): UndoRedoReservation {
    const storedEntry =
      reservation.mode === 'undo'
        ? this.composeGroupedEntry(
            this.resolveUndoGroup(state.entries, state.cursor - 1).entries
          )
        : this.composeGroupedEntry(this.resolveRedoGroup(state.entries, state.cursor).entries);
    return {
      token: reservation.token,
      mode: reservation.mode,
      entry: this.attachScope(scope, storedEntry),
      operationId: reservation.operationId,
      executionStatus: reservation.executionStatus,
      executedLeafIndex: reservation.executedLeafIndex,
    };
  }

  private isLiveReservation(reservation: StoredReservation | undefined): boolean {
    if (!reservation) {
      return false;
    }
    if (reservation.executionStatus === 'succeeded') {
      return true;
    }
    return reservation.leaseUntil > this.now();
  }

  private commitSucceededMeta(meta: SplitUndoRedoState): SplitUndoRedoState {
    if (meta.reservation?.executionStatus !== 'succeeded') {
      return meta;
    }
    return {
      format: meta.format,
      entryIds: meta.entryIds,
      cursor: meta.reservation.cursorAfterCommit,
      nextSequence: meta.nextSequence,
      revision: (meta.revision ?? 0) + 1,
    };
  }

  private commitSucceededLoaded(state: LoadedState): void {
    if (state.reservation?.executionStatus !== 'succeeded') {
      return;
    }
    state.cursor = state.reservation.cursorAfterCommit;
    state.revision += 1;
    state.reservation = undefined;
  }

  private reservationTakeover(
    existing: StoredReservation | undefined,
    mode: UndoRedoReplayMode
  ): { operationId?: string; executedLeafIndex: number } {
    if (existing?.mode === mode) {
      return {
        operationId: existing.operationId,
        executedLeafIndex: existing.executedLeafIndex,
      };
    }
    return { executedLeafIndex: 0 };
  }

  private createReservation(
    mode: UndoRedoReplayMode,
    cursorAfterCommit: number,
    operationId?: string,
    executedLeafIndex = 0
  ): StoredReservation {
    return {
      token: crypto.randomUUID(),
      mode,
      cursorAfterCommit,
      operationId: operationId ?? crypto.randomUUID(),
      executionStatus: 'reserved',
      leaseUntil: this.now() + this.leaseMs,
      executedLeafIndex,
      inFlight: true,
    };
  }

  private enqueueScope<T>(scope: UndoScope, work: () => Promise<T>): Promise<T> {
    const redis = this.getRedis();
    if (redis) {
      return this.withRedisLock(scope, redis, work);
    }
    const key = this.scopeKey(scope);
    const previous = this.scopeTail.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.scopeTail.set(key, settled);
    void settled.then(() => {
      if (this.scopeTail.get(key) === settled) {
        this.scopeTail.delete(key);
      }
    });
    return run;
  }

  private getRedis(): RedisLockClient | undefined {
    if (!('opts' in this.keyv)) {
      return undefined;
    }
    const opts = this.keyv.opts;
    if (!opts || typeof opts !== 'object' || !('store' in opts)) {
      return undefined;
    }
    const store = opts.store;
    if (!store || typeof store !== 'object' || !('redis' in store)) {
      return undefined;
    }
    if (!isRedisLockClient(store.redis)) {
      return undefined;
    }
    return store.redis;
  }

  private async withRedisLock<T>(
    scope: UndoScope,
    redis: RedisLockClient,
    work: () => Promise<T>
  ): Promise<T> {
    const lockKey = `${this.scopeKey(scope)}:lock`;
    const token = crypto.randomUUID();
    for (let attempt = 0; attempt < this.lockAttempts; attempt += 1) {
      const acquired = await redis.set(lockKey, token, 'EX', LOCK_TTL_SECONDS, 'NX');
      if (acquired === 'OK' || acquired === true || acquired === 1) {
        const extendTimer = setInterval(() => {
          void this.extendLock(redis, lockKey, token);
        }, LOCK_EXTEND_INTERVAL_MS);
        try {
          return await work();
        } finally {
          clearInterval(extendTimer);
          await this.releaseLock(redis, lockKey, token);
        }
      }
      await sleep(this.lockRetryDelayMs);
    }
    const timeout = err(
      domainError.conflict({
        code: 'undo_redo.scope_lock_timeout',
        message: 'Undo/redo scope lock timeout',
      })
    );
    return timeout as T;
  }

  private async releaseLock(redis: RedisLockClient, lockKey: string, token: string): Promise<void> {
    if (redis.eval) {
      await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
      return;
    }
    const held = redis.get ? await redis.get(lockKey) : token;
    if (held === token) {
      await redis.del(lockKey);
    }
  }

  private async extendLock(redis: RedisLockClient, lockKey: string, token: string): Promise<void> {
    if (redis.eval) {
      await redis.eval(EXTEND_LOCK_LUA, 1, lockKey, token, String(LOCK_TTL_SECONDS));
    }
  }

  private async reserveAndCommit(scope: UndoScope, mode: UndoRedoReplayMode) {
    const reserved = await this.reserve(scope, mode);
    if (reserved.isErr()) {
      return err(reserved.error);
    }
    if (!reserved.value) {
      return ok(null);
    }
    const committed = await this.commit(scope, reserved.value.token);
    if (committed.isErr()) {
      return err(committed.error);
    }
    return ok(reserved.value.entry);
  }

  private async appendSplitEntry(
    scope: UndoScope,
    entry: StoredUndoEntry,
    state: SplitUndoRedoState
  ) {
    let entryIds =
      state.cursor < state.entryIds.length
        ? state.entryIds.slice(0, state.cursor)
        : [...state.entryIds];

    if (state.cursor < state.entryIds.length) {
      await this.deleteEntryKeys(scope, state.entryIds.slice(state.cursor));
    }

    let nextSequence = state.nextSequence;
    const nextEntryId = String(nextSequence++);
    entryIds.push(nextEntryId);

    if (this.maxEntries && this.maxEntries > 0 && entryIds.length > this.maxEntries) {
      const droppedCount = entryIds.length - this.maxEntries;
      const droppedEntryIds = entryIds.slice(0, droppedCount);
      await this.deleteEntryKeys(scope, droppedEntryIds);
      entryIds = entryIds.slice(droppedCount);
    }

    await this.persistEntryValue(scope, nextEntryId, entry);
    await this.persistMeta(scope, {
      format: 'split-v1',
      entryIds,
      cursor: entryIds.length,
      nextSequence,
      revision: (state.revision ?? 0) + 1,
    });

    return ok(undefined);
  }

  private async loadState(scope: UndoScope): Promise<LoadedState> {
    const raw = await this.readPersistedValue(this.scopeKey(scope));

    if (isSplitUndoRedoState(raw)) {
      const entries: StoredUndoEntry[] = [];
      const entryIds: string[] = [];

      for (const entryId of raw.entryIds) {
        const entry = await this.readPersistedValue(this.entryKey(scope, entryId));
        if (!isStoredUndoEntry(entry)) {
          continue;
        }
        entryIds.push(entryId);
        entries.push(entry);
      }

      return {
        format: 'split',
        entryIds,
        entries,
        cursor: Math.min(raw.cursor, entries.length),
        nextSequence: Math.max(raw.nextSequence, entryIds.length + 1),
        revision: raw.revision ?? 0,
        ...(isStoredReservation(raw.reservation)
          ? { reservation: toStoredReservation(raw.reservation) }
          : {}),
      };
    }

    if (isLegacyUndoRedoState(raw)) {
      const entries = raw.entries.filter(isStoredUndoEntry);
      return {
        format: 'inline',
        entryIds: entries.map((_, index) => String(index + 1)),
        entries,
        cursor: Math.min(raw.cursor, entries.length),
        nextSequence: entries.length + 1,
        revision: 0,
      };
    }

    return {
      format: 'empty',
      entryIds: [],
      entries: [],
      cursor: 0,
      nextSequence: 1,
      revision: 0,
    };
  }

  private async persistAfterCursorChange(
    scope: UndoScope,
    state: LoadedState,
    cursor: number
  ): Promise<void> {
    if (state.format !== 'split') {
      await this.persistAllEntries(scope, state.entryIds, state.entries);
    }

    await this.persistMeta(scope, {
      format: 'split-v1',
      entryIds: state.entryIds,
      cursor,
      nextSequence: state.nextSequence,
      revision: state.revision + 1,
    });
  }

  private async persistReservation(
    scope: UndoScope,
    state: LoadedState,
    reservation: StoredReservation | undefined
  ): Promise<void> {
    if (state.format !== 'split') {
      await this.persistAllEntries(scope, state.entryIds, state.entries);
    }

    await this.persistMeta(scope, {
      format: 'split-v1',
      entryIds: state.entryIds,
      cursor: state.cursor,
      nextSequence: state.nextSequence,
      revision: state.revision,
      ...(reservation ? { reservation } : {}),
    });
  }

  private resolveUndoGroup(entries: StoredUndoEntry[], currentIndex: number) {
    const current = entries[currentIndex]!;
    const groupId = current.groupId;
    if (!groupId) {
      return {
        startIndex: currentIndex,
        entries: [current],
      };
    }

    let startIndex = currentIndex;
    while (startIndex > 0 && entries[startIndex - 1]?.groupId === groupId) {
      startIndex -= 1;
    }

    return {
      startIndex,
      entries: entries.slice(startIndex, currentIndex + 1),
    };
  }

  private resolveRedoGroup(entries: StoredUndoEntry[], cursor: number) {
    const current = entries[cursor]!;
    const groupId = current.groupId;
    if (!groupId) {
      return {
        endIndex: cursor + 1,
        entries: [current],
      };
    }

    let endIndex = cursor + 1;
    while (endIndex < entries.length && entries[endIndex]?.groupId === groupId) {
      endIndex += 1;
    }

    return {
      endIndex,
      entries: entries.slice(cursor, endIndex),
    };
  }

  private composeGroupedEntry(entries: ReadonlyArray<StoredUndoEntry>): StoredUndoEntry {
    const undoCommands = entries
      .slice()
      .reverse()
      .flatMap((entry) => flattenUndoRedoCommands(entry.undoCommand));
    const redoCommands = entries.flatMap((entry) => flattenUndoRedoCommands(entry.redoCommand));
    const tail = entries.at(-1)!;

    return {
      undoCommand: composeUndoRedoCommands(undoCommands),
      redoCommand: composeUndoRedoCommands(redoCommands),
      groupId: tail.groupId,
      recordVersionBefore: entries[0]?.recordVersionBefore,
      recordVersionAfter: tail.recordVersionAfter,
      createdAt: tail.createdAt,
      requestId: tail.requestId,
    };
  }

  private async persistMeta(scope: UndoScope, state: SplitUndoRedoState): Promise<void> {
    await this.persistValue(this.scopeKey(scope), state);
  }

  private async persistAllEntries(
    scope: UndoScope,
    entryIds: ReadonlyArray<string>,
    entries: ReadonlyArray<StoredUndoEntry>
  ): Promise<void> {
    for (let index = 0; index < entryIds.length; index += 1) {
      const entryId = entryIds[index];
      const entry = entries[index];
      if (!entryId || !entry) {
        continue;
      }
      await this.persistEntryValue(scope, entryId, entry);
    }
  }

  private async persistEntryValue(
    scope: UndoScope,
    entryId: string,
    entry: StoredUndoEntry
  ): Promise<void> {
    await this.persistValue(this.entryKey(scope, entryId), entry);
  }

  private async persistValue(key: string, value: unknown): Promise<void> {
    const persisted = this.maybeCompress(value);
    if (this.ttlMs && this.ttlMs > 0) {
      await this.keyv.set(key, persisted, this.ttlMs);
      return;
    }

    await this.keyv.set(key, persisted);
  }

  private async readPersistedValue(key: string): Promise<unknown> {
    const raw = await this.keyv.get(key);
    return this.maybeDecompress(raw);
  }

  private maybeCompress(value: unknown): unknown {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') < this.compressionThresholdBytes) {
      return value;
    }

    const compressed = gzipSync(Buffer.from(serialized, 'utf8'));
    if (compressed.byteLength >= Buffer.byteLength(serialized, 'utf8')) {
      return value;
    }

    return {
      format: 'gz64-json',
      data: compressed.toString('base64'),
    } satisfies CompressedValue;
  }

  private maybeDecompress(value: unknown): unknown {
    if (!isCompressedValue(value)) {
      return value;
    }

    try {
      const compressedBuffer = Buffer.from(value.data, 'base64');
      const decompressed =
        value.format === 'br64-json'
          ? brotliDecompressSync(compressedBuffer).toString('utf8')
          : gunzipSync(compressedBuffer).toString('utf8');
      return JSON.parse(decompressed) as unknown;
    } catch {
      return undefined;
    }
  }

  private async deleteEntryKeys(scope: UndoScope, entryIds: ReadonlyArray<string>): Promise<void> {
    for (const entryId of entryIds) {
      await this.keyv.delete(this.entryKey(scope, entryId));
    }
  }

  private stripScope(entry: UndoEntry): StoredUndoEntry {
    const { scope: _scope, ...stored } = entry;
    return stored;
  }

  private attachScope(scope: UndoScope, entry: StoredUndoEntry): UndoEntry {
    return {
      ...entry,
      scope,
    };
  }

  private scopeKey(scope: UndoScope): string {
    return `${this.keyPrefix}:${scope.actorId.toString()}:${scope.tableId.toString()}:${scope.windowId}`;
  }

  private entryKey(scope: UndoScope, entryId: string): string {
    return `${this.scopeKey(scope)}:entry:${entryId}`;
  }
}
