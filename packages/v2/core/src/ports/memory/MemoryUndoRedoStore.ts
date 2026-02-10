import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IUndoRedoStore, UndoEntry, UndoRedoListOptions, UndoScope } from '../UndoRedoStore';

type UndoRedoState = {
  entries: UndoEntry[];
  cursor: number;
};

export class MemoryUndoRedoStore implements IUndoRedoStore {
  private readonly states = new Map<string, UndoRedoState>();

  async append(scope: UndoScope, entry: UndoEntry): Promise<Result<void, DomainError>> {
    const state = this.getState(scope);
    if (state.cursor < state.entries.length) {
      state.entries = state.entries.slice(0, state.cursor);
    }
    state.entries.push(entry);
    state.cursor = state.entries.length;
    return ok(undefined);
  }

  async undo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    const state = this.getState(scope);
    if (state.cursor <= 0) {
      return ok(null);
    }
    state.cursor -= 1;
    return ok(state.entries[state.cursor] ?? null);
  }

  async redo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    const state = this.getState(scope);
    if (state.cursor >= state.entries.length) {
      return ok(null);
    }
    const entry = state.entries[state.cursor] ?? null;
    state.cursor += 1;
    return ok(entry);
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

  private getState(scope: UndoScope): UndoRedoState {
    const key = this.scopeKey(scope);
    const existing = this.states.get(key);
    if (existing) return existing;
    const created: UndoRedoState = { entries: [], cursor: 0 };
    this.states.set(key, created);
    return created;
  }

  private scopeKey(scope: UndoScope): string {
    return `${scope.actorId.toString()}::${scope.tableId.toString()}::${scope.windowId}`;
  }
}
