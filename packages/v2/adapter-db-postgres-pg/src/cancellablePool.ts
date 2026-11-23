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
  scope: CancellationScope | undefined,
  connectionConstructor: PostgresProtocolConnectionConstructor,
  statementDeadlineMs?: number,
  probeConnection?: () => Promise<void>
): PostgresPoolClient => {
  const signal = scope?.signal;
  let released = false;
  let releaseRequested = false;
  let cancellationAttempted = false;
  let cancellationSettled = true;
  let statementSequence = 0;
  let activeStatement: number | undefined;
  let connectionFailure: Error | undefined;
  const onClientError = (error: Error) => {
    connectionFailure ??= error;
    releaseRequested = true;
    releaseIfSettled();
  };
  client.on('error', onClientError);

  const releaseIfSettled = () => {
    if (released || !releaseRequested || activeStatement || !cancellationSettled) return;
    released = true;
    client.removeListener('error', onClientError);
    // An abort between statements can prevent Kysely's ROLLBACK from running.
    client.release(connectionFailure ?? (cancellationAttempted || signal?.aborted === true));
  };

  const query = async <R>(
    text: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<PostgresQueryResult<R>> => {
    if (connectionFailure) throw connectionFailure;
    if (scope && (signal?.aborted || cancellationAttempted))
      throw recordPostgresQueryCancellation(scope);
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
    signal?.addEventListener('abort', abort, { once: true });
    let deadline: NodeJS.Timeout | undefined;
    let probeTimer: NodeJS.Timeout | undefined;
    try {
      // Only a dedicated maintenance pool may use this deadline. Destroying the
      // socket does not prove the server has stopped or rolled back the statement.
      const pending = client.query(text, parameters as unknown[]);
      const timeout =
        statementDeadlineMs &&
        new Promise<never>((_, reject) => {
          const discard = (failure: Error) => {
            if (!isActive()) return;
            connectionFailure = failure;
            released = true;
            // Keep an error listener until pg closes the socket, including when
            // the original query never settles after the connection is destroyed.
            client.once('end', () => client.removeListener('error', onClientError));
            client.release(true);
            reject(failure);
          };
          deadline = setTimeout(
            () =>
              discard(
                Object.assign(new Error('PostgreSQL maintenance statement deadline exceeded'), {
                  code: 'TABLE_QUERY_OPS_STATEMENT_TIMEOUT',
                })
              ),
            statementDeadlineMs
          );
          if (probeConnection) {
            const probe = async () => {
              try {
                await probeConnection();
                if (isActive()) probeTimer = setTimeout(probe, 10_000);
              } catch (error) {
                discard(error instanceof Error ? error : new Error(String(error)));
              }
            };
            probeTimer = setTimeout(probe, 10_000);
          }
        });
      const result = timeout ? await Promise.race([pending, timeout]) : await pending;
      if (connectionFailure) throw connectionFailure;
      if (scope && signal?.aborted) throw recordPostgresQueryCancellation(scope);
      return result as PostgresQueryResult<R>;
    } catch (error) {
      if (
        scope &&
        signal?.aborted &&
        cancellationAttempted &&
        error instanceof Error &&
        'code' in error &&
        error.code === '57014'
      ) {
        throw recordPostgresQueryCancellation(scope, error);
      }
      throw connectionFailure ?? error;
    } finally {
      signal?.removeEventListener('abort', abort);
      clearTimeout(deadline);
      clearTimeout(probeTimer);
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
  owned: boolean,
  statementDeadlineMs?: number,
  probeConnection?: () => Promise<void>
): PostgresPool => ({
  connect: async () => {
    const scope = getPostgresQueryCancellationScope();
    const client = scope ? await acquire(pool, scope) : await pool.connect();
    // Abort can win between the acquisition's resolution and this continuation.
    if (scope?.signal.aborted) {
      client.release();
      throw recordPostgresQueryCancellation(scope);
    }
    return checkout(client, scope, connectionConstructor, statementDeadlineMs, probeConnection);
  },
  end: () => (owned ? pool.end() : Promise.resolve()),
});
