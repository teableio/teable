import { brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import type Keyv from 'keyv';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type {
  IUndoRedoStore,
  DomainError,
  UndoEntry,
  UndoEntryInput,
  UndoRedoListOptions,
  UndoRedoCommandData,
  UndoRedoReplayMode,
  UndoRedoReservation,
  UndoScope,
} from '@teable/v2-core';
import { composeUndoRedoCommands, domainError, flattenUndoRedoCommands } from '@teable/v2-core';

type StoredUndoEntry = Omit<UndoEntry, 'scope'> & {
  /** Durable evidence of an explicitly started interaction across cache loss. */
  groupStartSequence?: number;
};

type LegacyUndoRedoState = {
  entries: StoredUndoEntry[];
  cursor: number;
};

type StoredReservation = {
  token: string;
  mode: UndoRedoReplayMode;
  cursorAfterCommit: number;
  entryCount: number;
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

type StoredGroup = {
  ranges: Array<{ startSequence: number; endSequence: number }>;
  groupId?: string;
  expiresAt?: number;
  groupStartSequence?: number;
  /** A missing legacy reference may belong here; never replay a suffix. */
  unavailable?: boolean;
};

type LoadedState = {
  groups: StoredGroup[];
  entryIds: string[];
  cursor: number;
  nextSequence: number;
  revision: number;
  reservation?: StoredReservation;
  inline?: { entries: StoredUndoEntry[]; expiresAt: number | null };
};

type GroupedUndoRedoState = Omit<LoadedState, 'inline'> & { format: 'split-v1' };

const isGroupedUndoRedoState = (value: unknown): value is GroupedUndoRedoState => {
  if (!isSplitUndoRedoState(value)) return false;
  const candidate = value as Partial<GroupedUndoRedoState>;
  if (
    !Array.isArray(candidate.groups) ||
    !Number.isInteger(value.cursor) ||
    value.cursor < 0 ||
    value.cursor > value.entryIds.length
  )
    return false;
  let entryIndex = 0;
  let cursorAtBoundary = value.cursor === 0;
  for (const group of candidate.groups) {
    if (
      !group ||
      !Array.isArray(group.ranges) ||
      group.ranges.length === 0 ||
      (group.groupId !== undefined && typeof group.groupId !== 'string') ||
      (group.expiresAt !== undefined && !Number.isFinite(group.expiresAt)) ||
      (group.groupStartSequence !== undefined &&
        (!Number.isSafeInteger(group.groupStartSequence) || group.groupStartSequence < 1)) ||
      (group.unavailable !== undefined && typeof group.unavailable !== 'boolean')
    )
      return false;
    if (
      group.groupStartSequence !== undefined &&
      group.ranges[0]?.startSequence !== group.groupStartSequence &&
      !group.unavailable
    )
      return false;
    for (const range of group.ranges) {
      if (
        !range ||
        !Number.isSafeInteger(range.startSequence) ||
        !Number.isSafeInteger(range.endSequence) ||
        range.startSequence < 1 ||
        range.endSequence <= range.startSequence
      )
        return false;
      for (let sequence = range.startSequence; sequence < range.endSequence; sequence += 1) {
        if (value.entryIds[entryIndex++] !== String(sequence)) return false;
      }
    }
    if (entryIndex === value.cursor) cursorAtBoundary = true;
  }
  return entryIndex === value.entryIds.length && cursorAtBoundary;
};

const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 16 * 1024;
// Keep the legacy ID-list protocol bounded without truncating a logical group.
// Numeric sequence references have at most 16 digits; the ID list alone stays
// below 640 KiB at this limit, independent of record snapshot size.
// This is a per-scope reference bound, not a global Redis byte budget.
const MAX_ENTRY_REFERENCES = 32_768;
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
    typeof candidate.cursorAfterCommit === 'number' &&
    (candidate.entryCount === undefined || typeof candidate.entryCount === 'number')
  );
};

const toStoredReservation = (value: StoredReservation): StoredReservation => ({
  token: value.token,
  mode: value.mode,
  cursorAfterCommit: value.cursorAfterCommit,
  entryCount: typeof value.entryCount === 'number' ? value.entryCount : 0,
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

  async append(scope: UndoScope, entry: UndoEntryInput, expectedRevision?: number) {
    return this.enqueueScope(scope, () => this.appendUnlocked(scope, entry, expectedRevision));
  }

  private async appendUnlocked(scope: UndoScope, entry: UndoEntryInput, expectedRevision?: number) {
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
    this.commitSucceededLoaded(state);
    if (this.isLiveReservation(state.reservation)) {
      return err(
        domainError.conflict({
          code: 'undo_redo.reservation_conflict',
          message: 'Undo/redo reservation already held for this window',
          localization: { i18nKey: 'httpErrors.undoRedo.inProgress' },
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
    const { scope: _scope, groupPosition, ...recorded } = entry;
    return this.appendGroupedEntry(scope, recorded, state, groupPosition);
  }

  async undo(scope: UndoScope) {
    return this.reserveAndCommit(scope, 'undo');
  }

  async redo(scope: UndoScope) {
    return this.reserveAndCommit(scope, 'redo');
  }

  async list(scope: UndoScope, options?: UndoRedoListOptions) {
    const envelope = await this.keyv.get(this.scopeKey(scope), { raw: true });
    const raw = await this.maybeDecompress(envelope?.value);
    if (isSplitUndoRedoState(raw) && raw.entryIds.length > MAX_ENTRY_REFERENCES) {
      return err(
        domainError.conflict({
          code: 'undo_redo.capacity_exceeded',
          message: 'Undo/redo history entry reference capacity exceeded',
        })
      );
    }
    const offset = Math.max(0, options?.offset ?? 0);
    const end = options?.limit === undefined ? undefined : offset + Math.max(0, options.limit);
    if (isLegacyUndoRedoState(raw)) {
      if (raw.entries.length > MAX_ENTRY_REFERENCES) {
        return err(
          domainError.conflict({
            code: 'undo_redo.capacity_exceeded',
            message: 'Undo/redo history entry reference capacity exceeded',
          })
        );
      }
      const entries: UndoEntry[] = [];
      for (const value of raw.entries.slice(offset, end)) {
        const entry = await this.decodeEntryValue(scope, value);
        if (entry.isErr()) return err(entry.error);
        entries.push(entry.value);
      }
      return ok(entries);
    }
    const entries: UndoEntry[] = [];
    if (isGroupedUndoRedoState(raw)) {
      let skip = offset;
      let remaining = options?.limit === undefined ? Infinity : Math.max(0, options.limit);
      for (const group of raw.groups) {
        if (this.isExpired(group)) continue;
        for (const range of group.ranges) {
          const count = range.endSequence - range.startSequence;
          if (skip >= count) {
            skip -= count;
            continue;
          }
          for (
            let sequence = range.startSequence + skip;
            sequence < range.endSequence && remaining > 0;
            sequence += 1
          ) {
            const value = await this.keyv.get(this.entryKey(scope, sequence));
            const entry = await this.decodeEntryValue(scope, value);
            if (entry.isErr()) return err(entry.error);
            entries.push(entry.value);
            remaining -= 1;
          }
          skip = 0;
          if (remaining <= 0) break;
        }
        if (remaining <= 0) break;
      }
    } else if (isSplitUndoRedoState(raw)) {
      for (const entryId of raw.entryIds.slice(offset, end)) {
        const value = await this.keyv.get(this.entryKey(scope, Number(entryId)));
        const entry = await this.decodeEntryValue(scope, value);
        if (entry.isErr()) return err(entry.error);
        entries.push(entry.value);
      }
    } else if (envelope !== undefined) {
      return err(
        domainError.conflict({
          code: 'undo_redo.unsupported_format',
          message: 'Undo/redo history metadata is unsupported or unavailable',
        })
      );
    }
    return ok(entries);
  }

  async reserve(scope: UndoScope, mode: UndoRedoReplayMode) {
    return this.enqueueScope(scope, () => this.reserveUnlocked(scope, mode));
  }

  private async reserveUnlocked(scope: UndoScope, mode: UndoRedoReplayMode) {
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
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
          localization: { i18nKey: 'httpErrors.undoRedo.inProgress' },
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
            localization: { i18nKey: 'httpErrors.undoRedo.inProgress' },
          })
        );
      }
      const reservation = { ...state.reservation, inFlight: true };
      await this.persistReservation(scope, state, reservation);
      return ok(this.toPublicReservation(scope, state, reservation));
    }

    let target = this.groupAtEntryIndex(state, mode === 'undo' ? state.cursor - 1 : state.cursor);
    if (!state.reservation) {
      while (target && this.isExpired(target.group)) {
        state.cursor = mode === 'undo' ? target.startIndex : target.endIndex;
        target = this.groupAtEntryIndex(state, mode === 'undo' ? state.cursor - 1 : state.cursor);
      }
    }
    if (!target) return ok(null);
    if (target.group.unavailable) return err(this.entryMissing());
    const takeover = this.reservationTakeover(state.reservation, mode);
    const reservation = this.createReservation(
      mode,
      mode === 'undo' ? target.startIndex : target.endIndex,
      this.groupEntryCount(target.group),
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

  private async markProgressUnlocked(scope: UndoScope, token: string, executedLeafIndex: number) {
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
    if (
      state.reservation?.token !== token ||
      !state.reservation ||
      !this.isLiveReservation(state.reservation)
    ) {
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
      leaseUntil: this.now() + this.leaseMs,
    });
    return ok(undefined);
  }

  async renew(scope: UndoScope, token: string) {
    return this.enqueueScope(scope, () => this.renewUnlocked(scope, token));
  }

  private async renewUnlocked(scope: UndoScope, token: string) {
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
    if (
      state.reservation?.token !== token ||
      !state.reservation ||
      !this.isLiveReservation(state.reservation)
    ) {
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
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
    if (
      state.reservation?.token !== token ||
      !state.reservation ||
      !this.isLiveReservation(state.reservation)
    ) {
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
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
    if (
      state.reservation?.token !== token ||
      !state.reservation ||
      !this.isLiveReservation(state.reservation)
    ) {
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
    const loaded = await this.loadState(scope);
    if (loaded.isErr()) return err(loaded.error);
    const state = loaded.value;
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
    _scope: UndoScope,
    state: LoadedState,
    reservation: StoredReservation
  ): UndoRedoReservation {
    const group = this.groupAtEntryIndex(
      state,
      reservation.mode === 'undo' ? state.cursor - 1 : state.cursor
    )!.group;
    return {
      token: reservation.token,
      mode: reservation.mode,
      entryCount: this.groupEntryCount(group),
      operationId: reservation.operationId,
      executionStatus: reservation.executionStatus,
      executedLeafIndex: reservation.executedLeafIndex,
    };
  }

  async readReservedEntry(scope: UndoScope, token: string, entryIndex: number) {
    return this.enqueueScope(scope, async () => {
      const loaded = await this.loadState(scope);
      if (loaded.isErr()) return err(loaded.error);
      const state = loaded.value;
      const reservation = state.reservation;
      const group = reservation
        ? this.groupAtEntryIndex(
            state,
            reservation.mode === 'undo' ? state.cursor - 1 : state.cursor
          )?.group
        : undefined;
      if (
        !reservation ||
        reservation.token !== token ||
        !reservation.inFlight ||
        !this.isLiveReservation(reservation) ||
        !Number.isInteger(entryIndex) ||
        entryIndex < 0 ||
        !group ||
        entryIndex >= this.groupEntryCount(group)
      ) {
        return err(
          domainError.conflict({
            code: 'undo_redo.reservation_conflict',
            message: 'Undo/redo reservation or entry index does not match',
          })
        );
      }
      if (group.unavailable || this.isExpired(group)) return err(this.entryMissing());
      let offset =
        reservation.mode === 'undo' ? this.groupEntryCount(group) - 1 - entryIndex : entryIndex;
      let sequence = 0;
      for (const range of group.ranges) {
        const count = range.endSequence - range.startSequence;
        if (offset < count) {
          sequence = range.startSequence + offset;
          break;
        }
        offset -= count;
      }
      const raw = await this.keyv.get(this.entryKey(scope, sequence), { raw: true });
      return this.decodeEntryValue(scope, raw?.value);
    });
  }

  private groupEntryCount(group: StoredGroup): number {
    return group.ranges.reduce((sum, range) => sum + range.endSequence - range.startSequence, 0);
  }

  private groupAtEntryIndex(state: LoadedState, index: number) {
    let startIndex = 0;
    for (const group of state.groups) {
      const endIndex = startIndex + this.groupEntryCount(group);
      if (index >= startIndex && index < endIndex) return { group, startIndex, endIndex };
      startIndex = endIndex;
    }
    return undefined;
  }

  private groupEntryIds(groups: ReadonlyArray<StoredGroup>): string[] {
    const entryIds: string[] = [];
    for (const group of groups) {
      for (const range of group.ranges) {
        for (let sequence = range.startSequence; sequence < range.endSequence; sequence += 1) {
          entryIds.push(String(sequence));
        }
      }
    }
    return entryIds;
  }

  private isExpired(group: StoredGroup): boolean {
    return group.expiresAt !== undefined && group.expiresAt <= this.now();
  }

  private entryMissing() {
    return domainError.notFound({
      code: 'undo_redo.entry_missing',
      message: 'Reserved undo/redo entry has expired or is unavailable',
    });
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
    entryCount: number,
    operationId?: string,
    executedLeafIndex = 0
  ): StoredReservation {
    return {
      token: crypto.randomUUID(),
      mode,
      cursorAfterCommit,
      entryCount,
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
        localization: { i18nKey: 'httpErrors.undoRedo.busy' },
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
    // Inspection helpers retain their historical composed return value. The
    // command executor uses readReservedEntry and never takes this eager path.
    const entries: StoredUndoEntry[] = [];
    for (let index = 0; index < reserved.value.entryCount; index += 1) {
      const entry = await this.readReservedEntry(scope, reserved.value.token, index);
      if (entry.isErr()) {
        await this.abort(scope, reserved.value.token);
        return err(entry.error);
      }
      entries.push(this.stripScope(entry.value));
    }
    if (mode === 'undo') entries.reverse();
    const committed = await this.commit(scope, reserved.value.token);
    if (committed.isErr()) return err(committed.error);
    return ok(this.attachScope(scope, this.composeGroupedEntry(entries)));
  }

  private async appendGroupedEntry(
    scope: UndoScope,
    entry: StoredUndoEntry,
    state: LoadedState,
    groupPosition?: 'start' | 'continue'
  ) {
    let appliedCount = 0;
    let appliedGroupCount = 0;
    while (appliedCount < state.cursor) {
      appliedCount += this.groupEntryCount(state.groups[appliedGroupCount++]!);
    }
    const appliedGroups = state.groups.slice(0, appliedGroupCount);
    const matching = entry.groupId
      ? appliedGroups.filter((group) => group.groupId === entry.groupId)
      : [];
    const sequence = state.nextSequence;
    const established = matching.length === 1 ? matching[0] : undefined;
    if (
      entry.groupId &&
      (groupPosition === 'start'
        ? state.groups.some((group) => group.groupId === entry.groupId)
        : groupPosition !== 'continue' ||
          !established ||
          established.groupStartSequence === undefined ||
          established.unavailable ||
          this.isExpired(established) ||
          state.groups.slice(appliedGroupCount).some((group) => group.groupId === entry.groupId))
    ) {
      return err(
        domainError.conflict({
          code: 'undo_redo.group_unavailable',
          message: 'Undo/redo group start or continuation is unavailable',
        })
      );
    }
    const groups = appliedGroups.filter((group) => !matching.includes(group));
    const discarded = state.groups.slice(appliedGroupCount);
    const deadlines = matching.flatMap((group) =>
      group.expiresAt === undefined ? [] : [group.expiresAt]
    );
    const group: StoredGroup = {
      ranges: matching.flatMap((fragment) => fragment.ranges.map((range) => ({ ...range }))),
      ...(entry.groupId
        ? {
            groupId: entry.groupId,
            groupStartSequence:
              groupPosition === 'start' ? sequence : established!.groupStartSequence!,
          }
        : {}),
      ...(deadlines.length
        ? { expiresAt: Math.min(...deadlines) }
        : this.ttlMs && this.ttlMs > 0 && matching.length === 0
          ? { expiresAt: this.now() + this.ttlMs }
          : {}),
    };
    const tail = group.ranges.at(-1);
    if (tail?.endSequence === sequence) tail.endSequence += 1;
    else group.ranges.push({ startSequence: sequence, endSequence: sequence + 1 });
    groups.push(group);
    let count = groups.reduce((sum, candidate) => sum + this.groupEntryCount(candidate), 0);
    if (this.maxEntries && this.maxEntries > 0) {
      while (groups.length > 1 && count > this.maxEntries) {
        // An unresolved legacy reference may belong to another old group.
        // maxEntries is soft for uncertain history, just as for a whole large
        // group: preserve its references and original expiry rather than
        // invent a boundary. The hard reference ceiling can reject new writes
        // before persistence; it does not promise globally bounded Redis bytes.
        if (groups[0]?.unavailable) break;
        const removed = groups.shift()!;
        count -= this.groupEntryCount(removed);
        discarded.push(removed);
      }
    }
    if (count > MAX_ENTRY_REFERENCES) {
      return err(
        domainError.conflict({
          code: 'undo_redo.capacity_exceeded',
          message: 'Undo/redo history entry reference capacity exceeded',
        })
      );
    }
    if (group.groupStartSequence !== undefined) entry.groupStartSequence = group.groupStartSequence;
    await this.persistValue(this.entryKey(scope, sequence), entry, group.expiresAt ?? null);
    if (this.isExpired(group)) return err(this.entryMissing());
    const entryIds = this.groupEntryIds(groups);
    await this.persistMeta(
      scope,
      {
        format: 'split-v1',
        groups,
        entryIds,
        cursor: entryIds.length,
        nextSequence: sequence + 1,
        revision: state.revision + 1,
      },
      state.inline
    );
    for (const removed of discarded) {
      for (const range of removed.ranges) {
        for (let prior = range.startSequence; prior < range.endSequence; prior += 1) {
          await this.keyv.delete(this.entryKey(scope, prior));
        }
      }
    }
    return ok(undefined);
  }

  private async loadState(scope: UndoScope) {
    const envelope = await this.keyv.get(this.scopeKey(scope), { raw: true });
    const raw = await this.maybeDecompress(envelope?.value);
    if (
      (isSplitUndoRedoState(raw) && raw.entryIds.length > MAX_ENTRY_REFERENCES) ||
      (isLegacyUndoRedoState(raw) && raw.entries.length > MAX_ENTRY_REFERENCES)
    ) {
      return err(
        domainError.conflict({
          code: 'undo_redo.capacity_exceeded',
          message: 'Undo/redo history entry reference capacity exceeded',
        })
      );
    }
    if (isGroupedUndoRedoState(raw)) {
      return ok<LoadedState>({
        groups: raw.groups,
        entryIds: raw.entryIds,
        cursor: raw.cursor,
        nextSequence: raw.nextSequence,
        revision: raw.revision ?? 0,
        ...(isStoredReservation(raw.reservation)
          ? { reservation: toStoredReservation(raw.reservation) }
          : {}),
      });
    }
    if (!isSplitUndoRedoState(raw) && !isLegacyUndoRedoState(raw)) {
      if (envelope !== undefined) {
        return err(
          domainError.conflict({
            code: 'undo_redo.unsupported_format',
            message: 'Undo/redo history metadata is unsupported or unavailable',
          })
        );
      }
      return ok<LoadedState>({ groups: [], entryIds: [], cursor: 0, nextSequence: 1, revision: 0 });
    }
    // Group ranges are a disposable cache beside the original split-v1 entry
    // list and entry-index cursor. Old writers drop the cache; reconstruct it
    // one payload at a time without copying blobs or refreshing their expiry.
    // The reference ceiling is checked before this per-reference payload scan.
    // Another old-writer cache drop can incur it again. It does not claim a
    // constant-memory bound for legacy inline history or one oversized blob.
    const inline = isLegacyUndoRedoState(raw) ? raw.entries : undefined;
    const split = isSplitUndoRedoState(raw) ? raw : undefined;
    const reservation =
      split && isStoredReservation(split.reservation)
        ? toStoredReservation(split.reservation)
        : undefined;
    const groups: StoredGroup[] = [];
    const applied = new Map<StoredGroup, boolean>();
    const missing: Array<{ sequence: number; isApplied: boolean }> = [];
    const historyExpiresAt = typeof envelope?.expires === 'number' ? envelope.expires : undefined;
    const count = inline ? inline.length : split!.entryIds.length;
    for (let index = 0; index < count; index += 1) {
      const sequence = split ? Number(split.entryIds[index]!) : index + 1;
      const prior = split
        ? await this.keyv.get(this.entryKey(scope, sequence), { raw: true })
        : envelope;
      if (!Number.isSafeInteger(sequence) || sequence < 1) return err(this.entryMissing());
      const entry = await this.decodeStoredEntryValue(inline ? inline[index] : prior?.value);
      const isApplied = index < raw.cursor;
      if (entry.isErr()) {
        // Keep the original reference and cursor position. Missing payloads
        // cannot reveal group identity, including across interleaved actions.
        const group: StoredGroup = {
          ranges: [{ startSequence: sequence, endSequence: sequence + 1 }],
          unavailable: true,
          ...(historyExpiresAt !== undefined ? { expiresAt: historyExpiresAt } : {}),
        };
        groups.push(group);
        applied.set(group, isApplied);
        missing.push({ sequence, isApplied });
        continue;
      }
      const groupId = entry.value.groupId;
      const groupStartSequence = entry.value.groupStartSequence;
      const last = groups.at(-1);
      // Preserve an active baseline reservation's contiguous original target.
      const existing = groupId
        ? reservation
          ? last?.groupId === groupId &&
            last.groupStartSequence === groupStartSequence &&
            applied.get(last) === isApplied
            ? groups.length - 1
            : -1
          : groups.findIndex(
              (group) =>
                group.groupId === groupId &&
                group.groupStartSequence === groupStartSequence &&
                applied.get(group) === isApplied
            )
        : -1;
      const group: StoredGroup =
        existing >= 0
          ? groups[existing]!
          : {
              ranges: [],
              ...(groupId ? { groupId } : {}),
              ...(groupStartSequence !== undefined ? { groupStartSequence } : {}),
            };
      if (existing >= 0 && isApplied) groups.splice(existing, 1);
      if (existing < 0 || isApplied) groups.push(group);
      applied.set(group, isApplied);
      const payloadExpiresAt = typeof prior?.expires === 'number' ? prior.expires : undefined;
      const deadline = Math.min(payloadExpiresAt ?? Infinity, historyExpiresAt ?? Infinity);
      if (Number.isFinite(deadline))
        group.expiresAt = Math.min(group.expiresAt ?? Infinity, deadline);
      const tail = group.ranges.at(-1);
      if (tail?.endSequence === sequence) tail.endSequence += 1;
      else group.ranges.push({ startSequence: sequence, endSequence: sequence + 1 });
    }
    for (const group of groups) {
      if (!group.groupId) continue;
      const start = group.groupStartSequence;
      const lastSequence = group.ranges.at(-1)!.endSequence - 1;
      if (
        (start !== undefined &&
          (!Number.isSafeInteger(start) ||
            start < 1 ||
            group.ranges[0]!.startSequence !== start)) ||
        missing.some(
          (hole) =>
            start === undefined ||
            (hole.isApplied === applied.get(group) &&
              hole.sequence >= start &&
              hole.sequence <= lastSequence)
        )
      ) {
        group.unavailable = true;
      }
    }
    const orderedGroups = [
      ...groups.filter((group) => applied.get(group)),
      ...groups.filter((group) => !applied.get(group)),
    ];
    const state: LoadedState = {
      groups: orderedGroups,
      entryIds: this.groupEntryIds(orderedGroups),
      cursor: raw.cursor,
      nextSequence: split?.nextSequence ?? count + 1,
      revision: split?.revision ?? 0,
      ...(reservation ? { reservation } : {}),
      ...(inline
        ? {
            inline: {
              entries: inline,
              expiresAt: typeof envelope?.expires === 'number' ? envelope.expires : null,
            },
          }
        : {}),
    };
    return ok(state);
  }

  private async persistAfterCursorChange(
    scope: UndoScope,
    state: LoadedState,
    cursor: number
  ): Promise<void> {
    await this.persistMeta(
      scope,
      {
        format: 'split-v1',
        groups: state.groups,
        entryIds: state.entryIds,
        cursor,
        nextSequence: state.nextSequence,
        revision: state.revision + 1,
      },
      state.inline
    );
  }

  private async persistReservation(
    scope: UndoScope,
    state: LoadedState,
    reservation: StoredReservation | undefined
  ): Promise<void> {
    const { inline, ...metadata } = state;
    await this.persistMeta(scope, { ...metadata, format: 'split-v1', reservation }, inline);
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

  private async persistMeta(
    scope: UndoScope,
    state: GroupedUndoRedoState,
    inline?: LoadedState['inline']
  ): Promise<void> {
    // Admission has already applied retention and the reference ceiling. Only
    // retained legacy inline entries are split; rejected appends write nothing.
    if (inline) {
      for (const entryId of state.entryIds) {
        const entry = inline.entries[Number(entryId) - 1];
        if (entry)
          await this.persistValue(this.entryKey(scope, Number(entryId)), entry, inline.expiresAt);
      }
    }
    await this.persistValue(this.scopeKey(scope), state);
  }

  private async persistValue(
    key: string,
    value: unknown,
    expiresAt?: number | null
  ): Promise<void> {
    const persisted = await this.maybeCompress(value);
    const ttlMs =
      expiresAt === undefined
        ? this.ttlMs
        : expiresAt === null
          ? undefined
          : expiresAt - this.now();
    if (ttlMs !== undefined && ttlMs <= 0 && expiresAt !== undefined) return;
    if (ttlMs && ttlMs > 0) {
      await this.keyv.set(key, persisted, ttlMs);
      return;
    }
    await this.keyv.set(key, persisted);
  }

  private async decodeEntryValue(
    scope: UndoScope,
    value: unknown
  ): Promise<Result<UndoEntry, DomainError>> {
    const decoded = await this.decodeStoredEntryValue(value);
    if (decoded.isErr()) return err(decoded.error);
    return ok(this.attachScope(scope, decoded.value));
  }

  private async decodeStoredEntryValue(
    value: unknown
  ): Promise<Result<StoredUndoEntry, DomainError>> {
    const decoded = await this.maybeDecompress(value);
    if (!isStoredUndoEntry(decoded)) return err(this.entryMissing());
    return ok(decoded);
  }

  private maybeCompress(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const serialized = JSON.stringify(value);
    const inputByteLength = Buffer.byteLength(serialized, 'utf8');
    if (inputByteLength < this.compressionThresholdBytes) return value;
    const compressed = gzipSync(Buffer.from(serialized, 'utf8'));
    if (compressed.byteLength >= inputByteLength) return value;
    return { format: 'gz64-json', data: compressed.toString('base64') } satisfies CompressedValue;
  }

  private maybeDecompress(value: unknown): unknown {
    if (!isCompressedValue(value)) return value;
    try {
      const compressedBuffer = Buffer.from(value.data, 'base64');
      const decompressed =
        value.format === 'br64-json'
          ? brotliDecompressSync(compressedBuffer)
          : gunzipSync(compressedBuffer);
      return JSON.parse(decompressed.toString('utf8')) as unknown;
    } catch {
      return undefined;
    }
  }

  private stripScope(entry: UndoEntry): StoredUndoEntry {
    const { scope: _scope, ...stored } = entry;
    return stored;
  }

  private attachScope(scope: UndoScope, entry: StoredUndoEntry): UndoEntry {
    return {
      scope,
      undoCommand: entry.undoCommand,
      redoCommand: entry.redoCommand,
      groupId: entry.groupId,
      recordVersionBefore: entry.recordVersionBefore,
      recordVersionAfter: entry.recordVersionAfter,
      createdAt: entry.createdAt,
      requestId: entry.requestId,
    };
  }

  private scopeKey(scope: UndoScope): string {
    return `${this.keyPrefix}:${scope.actorId.toString()}:${scope.tableId.toString()}:${scope.windowId}`;
  }

  private entryKey(scope: UndoScope, sequence: number): string {
    return `${this.scopeKey(scope)}:entry:${sequence}`;
  }
}
