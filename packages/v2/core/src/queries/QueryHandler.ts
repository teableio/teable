import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { TraceSpan, isTraceSpanWrapped } from '../ports/TraceSpan';

export interface IQueryHandler<TQuery, TResult> {
  handle(context: IExecutionContext, query: TQuery): Promise<Result<TResult, DomainError>>;
}

export type QueryType<TQuery> = {
  readonly prototype: TQuery;
  readonly name: string;
};
export type QueryHandlerClass<TQuery, TResult> = {
  readonly prototype: IQueryHandler<TQuery, TResult>;
};

const queryHandlerRegistry = new Map<QueryType<unknown>, QueryHandlerClass<unknown, unknown>>();

export const QueryHandler =
  <TQuery>(query: QueryType<TQuery>) =>
  (target: QueryHandlerClass<TQuery, unknown>): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, 'handle');
    if (
      descriptor &&
      typeof descriptor.value === 'function' &&
      !isTraceSpanWrapped(descriptor.value)
    ) {
      TraceSpan()(target.prototype, 'handle', descriptor);
      Object.defineProperty(target.prototype, 'handle', descriptor);
    }
    queryHandlerRegistry.set(query, target as QueryHandlerClass<unknown, unknown>);
  };

export const getQueryHandlerToken = (
  query: QueryType<unknown>
): QueryHandlerClass<unknown, unknown> | undefined => queryHandlerRegistry.get(query);
