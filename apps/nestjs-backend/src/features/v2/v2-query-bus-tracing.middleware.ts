import type { QueryBusNext, IQueryBusMiddleware, IExecutionContext } from '@teable/v2-core';

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

export class QueryBusTracingMiddleware implements IQueryBusMiddleware {
  async handle<TQuery, TResult>(
    context: IExecutionContext,
    query: TQuery,
    next: QueryBusNext<TQuery, TResult>
  ) {
    const tracer = context.tracer;
    if (!tracer) {
      return next(context, query);
    }

    const queryName =
      (query as { constructor?: { name?: string } }).constructor?.name ?? 'UnknownQuery';
    const span = tracer.startSpan(`teable.query.${queryName}`, {
      query: queryName,
    });

    try {
      const result = await next(context, query);
      if (result.isErr()) {
        span.recordError(result.error.message ?? 'Unknown error');
      }
      return result;
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.end();
    }
  }
}
