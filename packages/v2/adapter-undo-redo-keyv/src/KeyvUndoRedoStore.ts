import type Keyv from 'keyv';
import { ok } from 'neverthrow';

import type {
  DomainError,
  IUndoRedoStore,
  UndoEntry,
  UndoRedoListOptions,
  UndoScope,
} from '@teable/v2-core';

type StoredUndoEntry = Omit<UndoEntry, 'scope'>;

type UndoRedoState = {
  entries: StoredUndoEntry[];
  cursor: number;
};

export interface KeyvUndoRedoStoreOptions {
  keyPrefix?: string;
  ttlMs?: number;
  maxEntries?: number;
}

const isUndoRedoState = (value: unknown): value is UndoRedoState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UndoRedoState>;
  return Array.isArray(candidate.entries) && typeof candidate.cursor === 'number';
};

export class KeyvUndoRedoStore implements IUndoRedoStore {
  private readonly keyPrefix: string;
  private readonly ttlMs?: number;
  private readonly maxEntries?: number;

  constructor(
    private readonly keyv: Pick<Keyv, 'get' | 'set' | 'delete'>,
    options?: KeyvUndoRedoStoreOptions
  ) {
    this.keyPrefix = options?.keyPrefix ?? 'v2:undo-redo';
    this.ttlMs = options?.ttlMs;
    this.maxEntries = options?.maxEntries;
  }

  async append(scope: UndoScope, entry: UndoEntry) {
    const state = await this.getState(scope);
    const nextEntries =
      state.cursor < state.entries.length
        ? state.entries.slice(0, state.cursor)
        : [...state.entries];
    nextEntries.push(this.stripScope(entry));

    const limitedEntries =
      this.maxEntries && this.maxEntries > 0 && nextEntries.length > this.maxEntries
        ? nextEntries.slice(-this.maxEntries)
        : nextEntries;

    await this.persistState(scope, {
      entries: limitedEntries,
      cursor: limitedEntries.length,
    });

    return ok(undefined);
  }

  async undo(scope: UndoScope) {
    const state = await this.getState(scope);
    if (state.cursor <= 0) {
      return ok(null);
    }

    const nextCursor = state.cursor - 1;
    const stored = state.entries[nextCursor] ?? null;
    await this.persistState(scope, {
      entries: state.entries,
      cursor: nextCursor,
    });

    return ok(stored ? this.attachScope(scope, stored) : null);
  }

  async redo(scope: UndoScope) {
    const state = await this.getState(scope);
    if (state.cursor >= state.entries.length) {
      return ok(null);
    }

    const stored = state.entries[state.cursor] ?? null;
    await this.persistState(scope, {
      entries: state.entries,
      cursor: state.cursor + 1,
    });

    return ok(stored ? this.attachScope(scope, stored) : null);
  }

  async list(scope: UndoScope, options?: UndoRedoListOptions) {
    const state = await this.getState(scope);
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    const end = limit === undefined ? state.entries.length : offset + Math.max(0, limit);
    return ok(state.entries.slice(offset, end).map((entry) => this.attachScope(scope, entry)));
  }

  private async getState(scope: UndoScope): Promise<UndoRedoState> {
    const raw = await this.keyv.get(this.scopeKey(scope));
    if (isUndoRedoState(raw)) {
      return raw;
    }
    return { entries: [], cursor: 0 };
  }

  private async persistState(scope: UndoScope, state: UndoRedoState): Promise<void> {
    const ttlMs = this.ttlMs;
    if (ttlMs && ttlMs > 0) {
      await this.keyv.set(this.scopeKey(scope), state, ttlMs);
      return;
    }

    await this.keyv.set(this.scopeKey(scope), state);
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
}
