/* eslint-disable @typescript-eslint/naming-convention */
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type UnitOfWorkOperation<T> = (
  context: IExecutionContext
) => Promise<Result<T, DomainError>>;

export interface IUnitOfWork {
  withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>>;
}
