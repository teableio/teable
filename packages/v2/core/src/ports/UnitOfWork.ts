/* eslint-disable @typescript-eslint/naming-convention */
import type { Result } from 'neverthrow';

import type { IExecutionContext } from './ExecutionContext';

export type UnitOfWorkOperation<T> = (context: IExecutionContext) => Promise<Result<T, string>>;

export interface IUnitOfWork {
  withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, string>>;
}
