import {
  PostgresQueryCancelledError,
  runWithPostgresQueryCancellation,
} from '@teable/v2-adapter-db-postgres-pg';
import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import type { IExecutionContext, IQueryBusMiddleware, QueryBusNext } from '@teable/v2-core';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

export const findCancellation = (error: unknown): PostgresQueryCancelledError | undefined => {
  const seen = new Set<object>();
  while (typeof error === 'object' && error !== null && !seen.has(error)) {
    if (error instanceof PostgresQueryCancelledError) return error;
    seen.add(error);
    error = 'cause' in error ? error.cause : undefined;
  }
  return undefined;
};

export class V2QueryCancellationMiddleware implements IQueryBusMiddleware {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  handle<TQuery, TResult>(
    context: IExecutionContext,
    query: TQuery,
    next: QueryBusNext<TQuery, TResult>
  ) {
    const signal =
      this.cls.get('useV2') && !getPostgresTransaction(context)
        ? this.cls.get('interactiveQueryAbort')
        : undefined;

    return runWithPostgresQueryCancellation(signal, async () => {
      if (!signal) return next(context, query);
      if (signal.aborted) throw new PostgresQueryCancelledError();

      try {
        const result = await next(context, query);
        if (signal.aborted) {
          if (result.isOk()) throw new PostgresQueryCancelledError();
          const cancellation = findCancellation(result.error);
          if (cancellation) throw cancellation;
        }
        return result;
      } catch (error) {
        const cancellation = signal.aborted ? findCancellation(error) : undefined;
        throw cancellation ?? error;
      }
    });
  }
}
