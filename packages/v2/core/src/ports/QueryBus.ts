import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type QueryBusNext<TQuery, TResult> = (
  context: IExecutionContext,
  query: TQuery
) => Promise<Result<TResult, DomainError>>;

export interface IQueryBusMiddleware {
  handle<TQuery, TResult>(
    context: IExecutionContext,
    query: TQuery,
    next: QueryBusNext<TQuery, TResult>
  ): Promise<Result<TResult, DomainError>>;
}

export interface IQueryBus {
  execute<TQuery, TResult>(
    context: IExecutionContext,
    query: TQuery
  ): Promise<Result<TResult, DomainError>>;
}
