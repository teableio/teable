import { brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import type Keyv from 'keyv';
import { ok } from 'neverthrow';

import type {
  DomainError,
  IUndoRedoStore,
  UndoEntry,
  UndoRedoListOptions,
  UndoRedoCommandData,
  UndoScope,
} from '@teable/v2-core';
import { composeUndoRedoCommands, flattenUndoRedoCommands } from '@teable/v2-core';

type StoredUndoEntry = Omit<UndoEntry, 'scope'>;

type LegacyUndoRedoState = {
  entries: StoredUndoEntry[];
  cursor: number;
};

type SplitUndoRedoState = {
  format: 'split-v1';
  entryIds: string[];
  cursor: number;
  nextSequence: number;
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
};

const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 16 * 1024;

export interface KeyvUndoRedoStoreOptions {
  keyPrefix?: string;
  ttlMs?: number;
  maxEntries?: number;
  compressionThresholdBytes?: number;
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

export class KeyvUndoRedoStore implements IUndoRedoStore {
  private readonly keyPrefix: string;
  private readonly ttlMs?: number;
  private readonly maxEntries?: number;
  private readonly compressionThresholdBytes: number;

  constructor(
    private readonly keyv: Pick<Keyv, 'get' | 'set' | 'delete'>,
    options?: KeyvUndoRedoStoreOptions
  ) {
    this.keyPrefix = options?.keyPrefix ?? 'v2:undo-redo';
    this.ttlMs = options?.ttlMs;
    this.maxEntries = options?.maxEntries;
    this.compressionThresholdBytes =
      options?.compressionThresholdBytes ?? DEFAULT_COMPRESSION_THRESHOLD_BYTES;
  }

  async append(scope: UndoScope, entry: UndoEntry) {
    const strippedEntry = this.stripScope(entry);
    const meta = await this.readPersistedValue(this.scopeKey(scope));
    if (isSplitUndoRedoState(meta)) {
      return this.appendSplitEntry(scope, strippedEntry, meta);
    }

    const state = await this.loadState(scope);
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
    });

    return ok(undefined);
  }

  async undo(scope: UndoScope) {
    const state = await this.loadState(scope);
    if (state.cursor <= 0) {
      return ok(null);
    }

    const currentIndex = state.cursor - 1;
    const group = this.resolveUndoGroup(state.entries, currentIndex);
    await this.persistAfterCursorChange(scope, state, group.startIndex);

    return ok(this.attachScope(scope, this.composeGroupedEntry(group.entries)));
  }

  async redo(scope: UndoScope) {
    const state = await this.loadState(scope);
    if (state.cursor >= state.entries.length) {
      return ok(null);
    }

    const group = this.resolveRedoGroup(state.entries, state.cursor);
    await this.persistAfterCursorChange(scope, state, group.endIndex);

    return ok(this.attachScope(scope, this.composeGroupedEntry(group.entries)));
  }

  async list(scope: UndoScope, options?: UndoRedoListOptions) {
    const state = await this.loadState(scope);
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = options?.limit;
    const end = limit === undefined ? state.entries.length : offset + Math.max(0, limit);
    return ok(state.entries.slice(offset, end).map((entry) => this.attachScope(scope, entry)));
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
      };
    }

    return {
      format: 'empty',
      entryIds: [],
      entries: [],
      cursor: 0,
      nextSequence: 1,
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
