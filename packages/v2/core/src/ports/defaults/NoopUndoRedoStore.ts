import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IUndoRedoStore, UndoEntry, UndoRedoListOptions, UndoScope } from '../UndoRedoStore';

export class NoopUndoRedoStore implements IUndoRedoStore {
  async append(_scope: UndoScope, _entry: UndoEntry): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async undo(_scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    return ok(null);
  }

  async redo(_scope: UndoScope): Promise<Result<UndoEntry | null, DomainError>> {
    return ok(null);
  }

  async list(
    _scope: UndoScope,
    _options?: UndoRedoListOptions
  ): Promise<Result<ReadonlyArray<UndoEntry>, DomainError>> {
    return ok([]);
  }
}
