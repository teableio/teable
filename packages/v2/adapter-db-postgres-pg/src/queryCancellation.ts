import { AsyncLocalStorage } from 'node:async_hooks';

export interface IPostgresQueryCancellationScope {
  readonly signal: AbortSignal;
  cancellation?: PostgresQueryCancelledError;
}

const cancellationScope = new AsyncLocalStorage<IPostgresQueryCancellationScope | undefined>();

export class PostgresQueryCancelledError extends Error {
  constructor(options?: ErrorOptions) {
    super('Interactive PostgreSQL query cancelled', options);
    this.name = 'PostgresQueryCancelledError';
  }
}

export const runWithPostgresQueryCancellation = <T>(
  signal: AbortSignal | undefined,
  work: () => Promise<T>
): Promise<T> => {
  if (!signal) return cancellationScope.run(undefined, work);
  const scope: IPostgresQueryCancellationScope = { signal };
  return cancellationScope.run(scope, async () => {
    try {
      const result = await work();
      // Repository Result wrappers may omit cause. Only driver-confirmed cancellation,
      // never a generic SQL/permission failure, overrides that wrapped result.
      if (scope.cancellation) throw scope.cancellation;
      return result;
    } catch (error) {
      throw scope.cancellation ?? error;
    }
  });
};

// Driver-private: callers establish scopes, but cannot mutate a checkout's ownership.
export const getPostgresQueryCancellationScope = () => cancellationScope.getStore();

export const recordPostgresQueryCancellation = (
  scope: IPostgresQueryCancellationScope,
  cause?: unknown
): PostgresQueryCancelledError => {
  const error = new PostgresQueryCancelledError(cause === undefined ? undefined : { cause });
  scope.cancellation ??= error;
  return error;
};
