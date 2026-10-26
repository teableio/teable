/* eslint-disable @typescript-eslint/naming-convention */
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext, UnitOfWorkScope } from './ExecutionContext';

export type UnitOfWorkOperation<T> = (
  context: IExecutionContext
) => Promise<Result<T, DomainError>>;

export interface IUnitOfWorkOptions {
  scope?: UnitOfWorkScope;
  /** Disable automatic retries when work consumes a non-replayable source. Defaults to true. */
  retry?: boolean;
}

export interface IUnitOfWork {
  withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>>;

  /**
   * Runs `work` inside a savepoint of the current transaction.
   *
   * Adapters that cannot express savepoints may omit the capability; callers must
   * then fail closed instead of assuming the surrounding transaction stays usable.
   * A failed `work` rolls back to the savepoint so the surrounding transaction can
   * continue and capture another error deliberately (for example a unique
   * constraint race in an upsert).
   */
  savepoint?<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>>;
}
