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

export interface IDomainWriteTransaction {
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
