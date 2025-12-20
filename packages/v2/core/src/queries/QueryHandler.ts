import type { Result } from 'neverthrow';

import type { IExecutionContext } from '../ports/ExecutionContext';

export interface IQueryHandler<TQuery, TResult> {
  handle(context: IExecutionContext, query: TQuery): Promise<Result<TResult, string>>;
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
    queryHandlerRegistry.set(query, target as QueryHandlerClass<unknown, unknown>);
  };

export const getQueryHandlerToken = (
  query: QueryType<unknown>
): QueryHandlerClass<unknown, unknown> | undefined => queryHandlerRegistry.get(query);
