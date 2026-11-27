import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type {
  IUndoRedoStore,
  UndoEntry,
  UndoEntryInput,
  UndoRedoListOptions,
  UndoRedoReplayMode,
  UndoRedoReservation,
  UndoScope,
} from '../UndoRedoStore';

export class NoopUndoRedoStore implements IUndoRedoStore {
  async append(
    _scope: UndoScope,
    _entry: UndoEntryInput,
    _expectedRevision?: number
  ): Promise<Result<void, DomainError>> {
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

  async reserve(
    _scope: UndoScope,
    _mode: UndoRedoReplayMode
  ): Promise<Result<UndoRedoReservation | null, DomainError>> {
    return ok(null);
  }

  async readReservedEntry(
    _scope: UndoScope,
    _token: string,
    _entryIndex: number
  ): Promise<Result<UndoEntry, DomainError>> {
    return err(domainError.conflict({ message: 'Undo/redo reservation does not exist' }));
  }

  async replaceReservedInverse(): Promise<Result<void, DomainError>> {
    return err(domainError.conflict({ message: 'Undo/redo reservation does not exist' }));
  }

  async markProgress(
    _scope: UndoScope,
    _token: string,
    _executedLeafIndex: number
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async markSucceeded(_scope: UndoScope, _token: string): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async renew(_scope: UndoScope, _token: string): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async commit(_scope: UndoScope, _token: string): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async abort(_scope: UndoScope, _token: string): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
