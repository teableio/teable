/* eslint-disable @typescript-eslint/naming-convention */
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext, UnitOfWorkScope } from './ExecutionContext';

export type UnitOfWorkOperation<T> = (
  context: IExecutionContext
) => Promise<Result<T, DomainError>>;

export interface IUnitOfWorkOptions {
  scope?: UnitOfWorkScope;
}

export interface IUnitOfWork {
  withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>>;
}
