import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import {
  composeUndoRedoCommands,
  flattenUndoRedoCommands,
  type IUndoRedoStore,
  type UndoEntry,
  type UndoEntryInput,
  type UndoRedoListOptions,
  type UndoRedoReplayMode,
  type UndoRedoReservation,
  type UndoScope,
} from '../UndoRedoStore';

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

type UndoRedoState = {
  entries: UndoEntry[];
  cursor: number;
  revision: number;
  reservation?: StoredReservation;
};

const DEFAULT_LEASE_MS = 15_000;

export type MemoryUndoRedoStoreOptions = {
  now?: () => number;
  leaseMs?: number;
};

const reservationConflict = (message: string) =>
  domainError.conflict({
    code: 'undo_redo.reservation_conflict',
    message,
  });

export class MemoryUndoRedoStore implements IUndoRedoStore {
  private readonly states = new Map<string, UndoRedoState>();
  // Retain admission evidence privately without changing stored/read UndoEntry objects.
  private readonly groupStarts = new WeakSet<UndoEntry>();
  private readonly now: () => number;
  private readonly leaseMs: number;

  constructor(options: MemoryUndoRedoStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  async append(
    scope: UndoScope,
    entry: UndoEntryInput,
    expectedRevision?: number
  ): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    this.commitSucceededReservation(state);
    if (this.isLiveReservation(state.reservation)) {
      return err(reservationConflict('Undo/redo reservation already held for this window'));
    }
    if (expectedRevision !== undefined && expectedRevision !== state.revision) {
      return err(
        domainError.conflict({
          code: 'undo_redo.revision_conflict',
          message: 'Undo/redo stack revision does not match',
        })
      );
    }
    const groupIndex =
      entry.groupId === undefined
        ? -1
        : state.entries.findIndex((existing) => existing.groupId === entry.groupId);
    const establishedGroup =
      groupIndex >= 0 &&
      groupIndex < state.cursor &&
      this.groupStarts.has(state.entries[groupIndex]!);
    if (
      entry.groupId !== undefined &&
      entry.groupPosition !== 'start' &&
      (entry.groupPosition !== 'continue' || !establishedGroup)
    ) {
      return err(
        domainError.conflict({
          code: 'undo_redo.group_unavailable',
          message: 'Undo/redo group start or continuation is unavailable',
        })
      );
    }
    if (entry.groupPosition === 'start' && groupIndex >= 0) {
      return err(
        domainError.conflict({
          code: 'undo_redo.group_unavailable',
          message: 'Undo/redo group start or continuation is unavailable',
        })
      );
    }
    state.reservation = undefined;
    if (state.cursor < state.entries.length) {
      state.entries = state.entries.slice(0, state.cursor);
    }
    // Keep a streamed interaction together even when independent actions interleave.
    if (entry.groupId && state.entries.at(-1)?.groupId !== entry.groupId) {
      const grouped: UndoEntry[] = [];
      let writeIndex = 0;
      for (const existing of state.entries) {
        if (existing.groupId === entry.groupId) grouped.push(existing);
        else state.entries[writeIndex++] = existing;
      }
      state.entries.length = writeIndex;
      for (const existing of grouped) state.entries.push(existing);
    }
    const { groupPosition: _groupPosition, ...storedEntry } = entry;
    state.entries.push(storedEntry);
    if (entry.groupPosition === 'start') this.groupStarts.add(storedEntry);
    state.cursor = state.entries.length;
    state.revision += 1;
    return ok(undefined);
  }

  async undo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    return this.reserveAndCommit(scope, 'undo');
  }

  async redo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    return this.reserveAndCommit(scope, 'redo');
  }

  async list(
    scope: UndoScope,
    options?: UndoRedoListOptions
  ): Promise<Result<ReadonlyArray<UndoEntry>, DomainError>> {
    const state = this.getState(scope);
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    const end = limit === undefined ? state.entries.length : offset + Math.max(0, limit);
    return ok(state.entries.slice(offset, end));
  }

  async reserve(
    scope: UndoScope,
    mode: UndoRedoReplayMode
  ): Promise<Result<UndoRedoReservation | null, DomainError>> {
    const state = this.getState(scope);
    if (state.reservation?.executionStatus === 'succeeded') {
      if (state.reservation.mode === mode) {
        return ok(this.toPublicReservation(state.reservation));
      }
      this.commitSucceededReservation(state);
    }
    if (this.isLiveReservation(state.reservation) && state.reservation?.inFlight) {
      return err(reservationConflict('Undo/redo reservation already held for this window'));
    }
    if (
      this.isLiveReservation(state.reservation) &&
      state.reservation &&
      !state.reservation.inFlight
    ) {
      if (state.reservation.mode !== mode) {
        return err(reservationConflict('Undo/redo reservation already held for this window'));
      }
      state.reservation = { ...state.reservation, inFlight: true };
      return ok(this.toPublicReservation(state.reservation));
    }

    if (mode === 'undo') {
      if (state.cursor <= 0) {
        return ok(null);
      }
      const group = this.resolveUndoGroup(state.entries, state.cursor - 1);
      const takeover = this.reservationTakeover(state.reservation, mode);
      state.reservation = this.createReservation(
        mode,
        group.startIndex,
        state.cursor - group.startIndex,
        takeover.operationId,
        takeover.executedLeafIndex
      );
      return ok(this.toPublicReservation(state.reservation));
    }

    if (state.cursor >= state.entries.length) {
      return ok(null);
    }
    const group = this.resolveRedoGroup(state.entries, state.cursor);
    const takeover = this.reservationTakeover(state.reservation, mode);
    state.reservation = this.createReservation(
      mode,
      group.endIndex,
      group.endIndex - state.cursor,
      takeover.operationId,
      takeover.executedLeafIndex
    );
    return ok(this.toPublicReservation(state.reservation));
  }

  async readReservedEntry(
    scope: UndoScope,
    token: string,
    entryIndex: number
  ): Promise<Result<UndoEntry, DomainError>> {
    const state = this.getState(scope);
    const reservation = state.reservation;
    if (
      !reservation ||
      reservation.token !== token ||
      !reservation.inFlight ||
      !this.isLiveReservation(reservation)
    ) {
      return err(reservationConflict('Undo/redo reservation token does not match'));
    }
    if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= reservation.entryCount) {
      return err(reservationConflict('Undo/redo reserved entry index is out of bounds'));
    }
    const index =
      reservation.mode === 'undo' ? state.cursor - 1 - entryIndex : state.cursor + entryIndex;
    const entry = state.entries[index];
    return entry ? ok(entry) : err(reservationConflict('Undo/redo reserved entry is missing'));
  }

  async renew(scope: UndoScope, token: string): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    if (
      !state.reservation ||
      state.reservation.token !== token ||
      !this.isLiveReservation(state.reservation)
    ) {
      return err(reservationConflict('Undo/redo reservation token does not match'));
    }
    state.reservation = { ...state.reservation, leaseUntil: this.now() + this.leaseMs };
    return ok(undefined);
  }
  async markSucceeded(scope: UndoScope, token: string): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    if (
      !state.reservation ||
      state.reservation.token !== token ||
      !this.isLiveReservation(state.reservation)
    ) {
      return err(reservationConflict('Undo/redo reservation token does not match'));
    }
    state.reservation = { ...state.reservation, executionStatus: 'succeeded' };
    return ok(undefined);
  }

  async markProgress(
    scope: UndoScope,
    token: string,
    executedLeafIndex: number
  ): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    if (
      !state.reservation ||
      state.reservation.token !== token ||
      !this.isLiveReservation(state.reservation)
    ) {
      return err(reservationConflict('Undo/redo reservation token does not match'));
    }
    state.reservation = {
      ...state.reservation,
      executedLeafIndex,
      leaseUntil: this.now() + this.leaseMs,
    };
    return ok(undefined);
  }

  async commit(scope: UndoScope, token: string): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    if (
      !state.reservation ||
      state.reservation.token !== token ||
      !this.isLiveReservation(state.reservation)
    ) {
      return err(reservationConflict('Undo/redo reservation token does not match'));
    }
    state.cursor = state.reservation.cursorAfterCommit;
    state.reservation = undefined;
    state.revision += 1;
    return ok(undefined);
  }

  async abort(scope: UndoScope, token: string): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    if (!state.reservation) {
      return ok(undefined);
    }
    if (state.reservation.token !== token) {
      return err(reservationConflict('Undo/redo reservation token does not match'));
    }
    if (state.reservation.executionStatus === 'succeeded') {
      return err(reservationConflict('Succeeded undo/redo reservation cannot be aborted'));
    }
    if (state.reservation.executedLeafIndex > 0) {
      state.reservation = { ...state.reservation, inFlight: false };
      return ok(undefined);
    }
    state.reservation = undefined;
    return ok(undefined);
  }

  private async reserveAndCommit(
    scope: UndoScope,
    mode: UndoRedoReplayMode
  ): Promise<Result<UndoEntry | null, DomainError>> {
    const reserved = await this.reserve(scope, mode);
    if (reserved.isErr()) {
      return err(reserved.error);
    }
    if (!reserved.value) {
      return ok(null);
    }
    const entries: UndoEntry[] = [];
    for (let index = 0; index < reserved.value.entryCount; index += 1) {
      const entry = await this.readReservedEntry(scope, reserved.value.token, index);
      if (entry.isErr()) {
        await this.abort(scope, reserved.value.token);
        return err(entry.error);
      }
      entries.push(entry.value);
    }
    if (mode === 'undo') entries.reverse();
    const committed = await this.commit(scope, reserved.value.token);
    if (committed.isErr()) {
      return err(committed.error);
    }
    return ok(this.composeGroupedEntry(entries));
  }

  private commitSucceededReservation(state: UndoRedoState): void {
    if (state.reservation?.executionStatus !== 'succeeded') {
      return;
    }
    state.cursor = state.reservation.cursorAfterCommit;
    state.reservation = undefined;
    state.revision += 1;
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

  private isLiveReservation(reservation: StoredReservation | undefined): boolean {
    if (!reservation) {
      return false;
    }
    if (reservation.executionStatus === 'succeeded') {
      return true;
    }
    return reservation.leaseUntil > this.now();
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

  private getState(scope: UndoScope): UndoRedoState {
    const key = this.scopeKey(scope);
    const existing = this.states.get(key);
    if (existing) return existing;
    const created: UndoRedoState = { entries: [], cursor: 0, revision: 0 };
    this.states.set(key, created);
    return created;
  }

  private toPublicReservation(reservation: StoredReservation): UndoRedoReservation {
    return {
      token: reservation.token,
      mode: reservation.mode,
      entryCount: reservation.entryCount,
      operationId: reservation.operationId,
      executionStatus: reservation.executionStatus,
      executedLeafIndex: reservation.executedLeafIndex,
    };
  }
  private scopeKey(scope: UndoScope): string {
    return `${scope.actorId.toString()}::${scope.tableId.toString()}::${scope.windowId}`;
  }

  private resolveUndoGroup(entries: ReadonlyArray<UndoEntry>, currentIndex: number) {
    const current = entries[currentIndex]!;
    const groupId = current.groupId;
    if (!groupId) {
      return {
        startIndex: currentIndex,
        endIndex: currentIndex + 1,
      };
    }

    let startIndex = currentIndex;
    while (startIndex > 0 && entries[startIndex - 1]?.groupId === groupId) {
      startIndex -= 1;
    }

    return {
      startIndex,
      endIndex: currentIndex + 1,
    };
  }

  private resolveRedoGroup(entries: ReadonlyArray<UndoEntry>, cursor: number) {
    const current = entries[cursor]!;
    const groupId = current.groupId;
    if (!groupId) {
      return {
        endIndex: cursor + 1,
        startIndex: cursor,
      };
    }

    let endIndex = cursor + 1;
    while (endIndex < entries.length && entries[endIndex]?.groupId === groupId) {
      endIndex += 1;
    }

    return {
      endIndex,
      startIndex: cursor,
    };
  }

  private composeGroupedEntry(entries: ReadonlyArray<UndoEntry>): UndoEntry {
    const undoCommands = entries
      .slice()
      .reverse()
      .flatMap((entry) => flattenUndoRedoCommands(entry.undoCommand));
    const redoCommands = entries.flatMap((entry) => flattenUndoRedoCommands(entry.redoCommand));
    const tail = entries.at(-1)!;

    return {
      ...tail,
      undoCommand: composeUndoRedoCommands(undoCommands),
      redoCommand: composeUndoRedoCommands(redoCommands),
      recordVersionBefore: entries[0]?.recordVersionBefore,
      recordVersionAfter: tail.recordVersionAfter,
    };
  }
}
