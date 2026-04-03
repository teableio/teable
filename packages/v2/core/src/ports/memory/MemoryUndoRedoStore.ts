import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  composeUndoRedoCommands,
  flattenUndoRedoCommands,
  type IUndoRedoStore,
  type UndoEntry,
  type UndoRedoListOptions,
  type UndoScope,
} from '../UndoRedoStore';

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
    const currentIndex = state.cursor - 1;
    const group = this.resolveUndoGroup(state.entries, currentIndex);
    state.cursor = group.startIndex;
    return ok(this.composeGroupedEntry(group.entries));
  }

  async redo(scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    const state = this.getState(scope);
    if (state.cursor >= state.entries.length) {
      return ok(null);
    }
    const group = this.resolveRedoGroup(state.entries, state.cursor);
    state.cursor = group.endIndex;
    return ok(this.composeGroupedEntry(group.entries));
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

  private resolveUndoGroup(entries: ReadonlyArray<UndoEntry>, currentIndex: number) {
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

  private resolveRedoGroup(entries: ReadonlyArray<UndoEntry>, cursor: number) {
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
