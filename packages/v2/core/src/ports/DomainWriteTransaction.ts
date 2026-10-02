import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IExecutionContext } from './ExecutionContext';
import type { LegacyEventDispatchReport } from './LegacyEventDispatcher';
import type { IUnitOfWorkOptions } from './UnitOfWork';

export type NonEmptyDomainEvents = readonly [IDomainEvent, ...ReadonlyArray<IDomainEvent>];

export type DomainWriteTable = Readonly<{
  id(): { toString(): string };
}>;

export type DomainWriteExtras = Readonly<{
  tables?: ReadonlyArray<DomainWriteTable>;
}>;

export type DomainWriteDecision<T> =
  | Readonly<{
      kind: 'changed';
      value: T;
      events: NonEmptyDomainEvents;
      tables?: ReadonlyArray<DomainWriteTable>;
    }>
  | Readonly<{
      kind: 'unchanged';
      value: T;
    }>;

export type DomainWriteCommit<T> = Readonly<{
  value: T;
  events: ReadonlyArray<IDomainEvent>;
  committed: true;
  directDelivery: Readonly<{
    awaited: LegacyEventDispatchReport;
    background: Readonly<{
      scheduledTargets: number;
      failedToScheduleTargets: number;
    }>;
  }>;
}>;

/** Public event metadata; deliberately not an IDomainEvent or a replayable snapshot. */
export type DomainEventSummary = Readonly<{ name: string; occurredAt: string }>;

export type DomainWriteStreamCommit<T> = Omit<DomainWriteCommit<T>, 'events'> &
  Readonly<{
    events: ReadonlyArray<DomainEventSummary>;
    /** Data committed, but delivery was withheld because finalization failed. */
    finalizationError?: DomainError;
  }>;

export interface IDomainWriteEventWriter {
  append(
    events: ReadonlyArray<IDomainEvent>,
    tables?: ReadonlyArray<DomainWriteTable>
  ): Promise<Result<void, DomainError>>;
}

export interface DomainWriteStreamOptions extends IUnitOfWorkOptions {
  /** Runs without a transaction after data commit and before any direct event delivery. */
  finalizeAfterCommit?(context: IExecutionContext): Promise<Result<void, DomainError>>;
}

export interface IDomainWriteTransaction {
  executeStream<T>(
    context: IExecutionContext,
    work: (
      transactionContext: IExecutionContext,
      events: IDomainWriteEventWriter
    ) => Promise<Result<T, DomainError>>,
    options?: DomainWriteStreamOptions
  ): Promise<Result<DomainWriteStreamCommit<T>, DomainError>>;

  execute<T>(
    context: IExecutionContext,
    work: (
      transactionContext: IExecutionContext
    ) => Promise<Result<DomainWriteDecision<T>, DomainError>>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<DomainWriteCommit<T>, DomainError>>;
}

export const domainWrite = {
  changed<T>(
    value: T,
    events: NonEmptyDomainEvents,
    extras?: DomainWriteExtras
  ): DomainWriteDecision<T> {
    return { kind: 'changed', value, events, tables: extras?.tables };
  },
  unchanged<T>(value: T): DomainWriteDecision<T> {
    return { kind: 'unchanged', value };
  },
  fromEvents<T>(
    value: T,
    events: ReadonlyArray<IDomainEvent>,
    extras?: DomainWriteExtras
  ): DomainWriteDecision<T> {
    if (events.length === 0) {
      return domainWrite.unchanged(value);
    }
    return domainWrite.changed(value, events as NonEmptyDomainEvents, extras);
  },
};
