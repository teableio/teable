import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IExecutionContext } from '../ExecutionContext';
import type { IUnitOfWork, UnitOfWorkOperation } from '../UnitOfWork';

export class NoopUnitOfWork implements IUnitOfWork {
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, string>> {
    try {
      return await work(context);
    } catch (error) {
      return err(`Unexpected unit of work error: ${describeError(error)}`);
    }
  }
}

const describeError = (error: unknown): string => {
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
