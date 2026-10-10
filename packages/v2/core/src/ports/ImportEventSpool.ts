import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';

/** Complete import-event snapshots, retained outside the JavaScript heap until commit. */
export interface IImportEventSpool {
  append(events: ReadonlyArray<IDomainEvent>): Promise<Result<void, DomainError>>;
  read(): AsyncIterable<Result<ReadonlyArray<IDomainEvent>, DomainError>>;
  dispose(): Promise<void>;
}

export interface IImportEventSpoolFactory {
  create(): Promise<Result<IImportEventSpool, DomainError>>;
}
