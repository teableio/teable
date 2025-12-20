import { err } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  getQueryHandlerToken,
  type IQueryHandler,
  type QueryHandlerClass,
  type QueryType,
} from '../../queries/QueryHandler';
import type { IExecutionContext } from '../ExecutionContext';
import type { IClassToken, IHandlerResolver } from '../HandlerResolver';
import type { QueryBusNext, IQueryBus, IQueryBusMiddleware } from '../QueryBus';

export class MemoryQueryBus implements IQueryBus {
  constructor(
    private readonly handlerResolver: IHandlerResolver,
    private readonly middlewares: ReadonlyArray<IQueryBusMiddleware> = []
  ) {}

  async execute<TQuery, TResult>(
    context: IExecutionContext,
    query: TQuery
  ): Promise<Result<TResult, string>> {
    const executeHandler = async (
      handlerContext: IExecutionContext,
      handlerQuery: TQuery
    ): Promise<Result<TResult, string>> => {
      const queryType = (handlerQuery as { constructor: QueryType<TQuery> }).constructor;
      const handlerToken = getQueryHandlerToken(queryType as QueryType<unknown>) as
        | QueryHandlerClass<TQuery, TResult>
        | undefined;

      if (!handlerToken) {
        return err(`Missing query handler for ${queryType.name}`);
      }

      try {
        const handler = this.handlerResolver.resolve(
          handlerToken as IClassToken<IQueryHandler<TQuery, TResult>>
        );
        return await handler.handle(handlerContext, handlerQuery);
      } catch (error) {
        if (error instanceof Error) {
          return err(error.message);
        }
        return err('Query handler execution failed');
      }
    };

    const pipeline = this.middlewares.reduceRight<QueryBusNext<TQuery, TResult>>(
      (next, middleware) => async (middlewareContext, middlewareQuery) => {
        try {
          return await middleware.handle(middlewareContext, middlewareQuery, next);
        } catch (error) {
          if (error instanceof Error) {
            return err(error.message);
          }
          return err('Query middleware execution failed');
        }
      },
      executeHandler as QueryBusNext<TQuery, TResult>
    );

    return pipeline(context, query);
  }
}
