import type { PostgresPool, PostgresPoolClient, PostgresQueryResult } from 'kysely';
import type { Pool, PoolClient } from 'pg';

import { cancelPostgresQuery, type PostgresProtocolConnectionConstructor } from './cancelRequest';
import {
  getPostgresQueryCancellationScope,
  recordPostgresQueryCancellation,
  type IPostgresQueryCancellationScope as CancellationScope,
} from './queryCancellation';

const acquire = (pool: Pool, scope: CancellationScope): Promise<PoolClient> => {
  const { signal } = scope;
  if (signal.aborted) return Promise.reject(recordPostgresQueryCancellation(scope));

  return new Promise((resolve, reject) => {
    const abort = () => reject(recordPostgresQueryCancellation(scope));
    signal.addEventListener('abort', abort, { once: true });
    // pg-pool has no public waiter removal API. Always consume a late checkout.
    pool.connect().then(
      (client) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          client.release();
          reject(recordPostgresQueryCancellation(scope));
        } else {
          resolve(client);
        }
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    );
  });
};

const checkout = (
  client: PoolClient,
  scope: CancellationScope,
  connectionConstructor: PostgresProtocolConnectionConstructor
): PostgresPoolClient => {
  const { signal } = scope;
  let released = false;
  let releaseRequested = false;
  let cancellationAttempted = false;
  let cancellationSettled = true;
  let statementSequence = 0;
  let activeStatement: number | undefined;

  const releaseIfSettled = () => {
    if (released || !releaseRequested || activeStatement || !cancellationSettled) return;
    released = true;
    client.release(cancellationAttempted);
  };

  const query = async <R>(
    text: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>> => {
    if (signal.aborted || cancellationAttempted) throw recordPostgresQueryCancellation(scope);
    if (released || releaseRequested) throw new Error('PostgreSQL checkout already released');
    // Kysely serializes work on a reserved connection. Do not put a second statement
    // behind one whose CancelRequest could still be in flight.
    if (activeStatement)
      throw new Error('Concurrent statements on a cancellable PostgreSQL checkout');
    const statement = ++statementSequence;
    activeStatement = statement;
    const isActive = () => !released && activeStatement === statement;
    const abort = () => {
      if (!isActive() || cancellationAttempted) return;
      cancellationAttempted = true;
      cancellationSettled = false;
      // A control failure does not mean SQL stopped. Keep observing the real query
      // and quarantine this lease until both connections have settled.
      void cancelPostgresQuery(client, connectionConstructor, isActive)
        .catch(() => undefined)
        .finally(() => {
          cancellationSettled = true;
          releaseIfSettled();
        });
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      // Call the real instrumented pg method; Kysely already owns this parameter array.
      const result = await client.query(text, parameters as unknown[]);
      if (signal.aborted) throw recordPostgresQueryCancellation(scope);
      return result as PostgresQueryResult<R>;
    } catch (error) {
      if (
        signal.aborted &&
        cancellationAttempted &&
        error instanceof Error &&
        'code' in error &&
        error.code === '57014'
      ) {
        throw recordPostgresQueryCancellation(scope, error);
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      activeStatement = undefined;
      releaseIfSettled();
    }
  };

  // This dialect has no cursor configured; only Kysely's string/parameters query
  // overload is used. Do not replace methods on the shared raw pg client.
  return {
    query,
    release: () => {
      releaseRequested = true;
      releaseIfSettled();
    },
  } as PostgresPoolClient;
};

export const createCancellablePool = (
  pool: Pool,
  connectionConstructor: PostgresProtocolConnectionConstructor,
  owned: boolean
): PostgresPool => ({
  connect: async () => {
    const scope = getPostgresQueryCancellationScope();
    if (!scope) return pool.connect();
    const client = await acquire(pool, scope);
    // Abort can win between the acquisition's resolution and this continuation.
    if (scope.signal.aborted) {
      client.release();
      throw recordPostgresQueryCancellation(scope);
    }
    return checkout(client, scope, connectionConstructor);
  },
  end: () => (owned ? pool.end() : Promise.resolve()),
});
