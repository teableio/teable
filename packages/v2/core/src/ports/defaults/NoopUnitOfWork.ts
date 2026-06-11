import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError, isDomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../ExecutionContext';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../UnitOfWork';

export class NoopUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    _options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    try {
      return await work(context);
    } catch (error) {
      return err(
        domainError.unexpected({
          message: `Unexpected unit of work error: ${describeError(error)}`,
        })
      );
    }
  }
}

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};
