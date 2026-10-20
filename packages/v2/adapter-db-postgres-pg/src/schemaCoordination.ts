import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import { handlePgPoolError, hasPgDefault, loadPg } from './createDb';

export interface IV2PgTableSchemaCoordinationOptions {
  connectionString: string;
  /**
   * Dedicated coordination connections. Defaults to 8. A held lease pins one
   * connection for its whole lifetime, so this is the maximum number of
   * concurrent coordinated operations, not part of the request pool.
   */
  maxConnections?: number;
  /**
   * Milliseconds to wait for a new PostgreSQL connection before failing.
   * Defaults to 10000; `0` disables the timeout.
   */
  connectionTimeoutMillis?: number;
  /** Transaction-local `application_name` while a coordination lease is held. */
  applicationName?: string;
}

const DEFAULT_MAX_CONNECTIONS = 8;
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 10_000;
const DEFAULT_APPLICATION_NAME = 'teable-v2-schema-coordination';
const POOL_DESTROYED_MESSAGE = 'Table schema coordination pool has been destroyed';

type CoordinationMode = 'shared' | 'exclusive';

interface ICoordinationLease {
  readonly mode: CoordinationMode;
  readonly tableIds: ReadonlyArray<string>;
  release(): Promise<void>;
}

const createLease = (
  mode: CoordinationMode,
  tableIds: ReadonlyArray<string>,
  release: () => Promise<void> = async () => undefined
): ICoordinationLease => ({
  mode,
  tableIds: Array.from(new Set(tableIds)).sort(),
  release,
});

interface IDeferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

const createDeferred = <T>(): IDeferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

/**
 * PostgreSQL advisory-lock coordination for table schema writes.
 *
 * A lease pins one connection from a dedicated pool and holds an open
 * transaction with `pg_advisory_xact_lock[_shared]` until `release()` commits
 * it. The dedicated pool keeps a held lease from consuming the shared meta
 * pool's connections, so waiters can never exhaust the request pool and stall
 * the business queries they are waiting on.
 *
 * Transaction-scoped locks cannot leak when a connection dies: PostgreSQL
 * releases them on rollback or disconnect. A checked-out client has no
 * pool-level `error` listener, so each lease installs its own; a lost
 * connection marks the lease broken, destroys the client, and makes `release()`
 * a no-op instead of letting an unhandled `error` event crash the process.
 */
export class V2PgTableSchemaCoordination {
  private poolPromise: Promise<Pool> | undefined;
  private pool: Pool | undefined;
  private destroyed = false;
  private readonly pendingAcquires = new Set<(error: Error) => void>();

  constructor(private readonly options: IV2PgTableSchemaCoordinationOptions) {}

  async acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode
  ): Promise<Result<ICoordinationLease, DomainError>> {
    const requested = Array.from(new Set(tableIds)).sort();
    if (requested.length === 0) {
      return ok(createLease(mode, []));
    }
    return this.acquireLocks(context, requested, mode);
  }

  private async acquireLocks(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode
  ): Promise<Result<ICoordinationLease, DomainError>> {
    if (this.destroyed) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.pool_destroyed',
          message: POOL_DESTROYED_MESSAGE,
        })
      );
    }

    let pool: Pool;
    try {
      pool = await this.getPool();
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.connect_failed',
          message: 'Failed to create the table schema coordination pool',
          cause: error instanceof Error ? error : undefined,
        })
      );
    }

    let client: PoolClient;
    try {
      client = await this.connectClient(pool);
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.connect_failed',
          message: 'Failed to acquire a table schema coordination connection',
          cause: error instanceof Error ? error : undefined,
        })
      );
    }

    let leaseReleased = false;
    let clientDisposed = false;
    let broken = false;

    const disposeClient = (destroy: boolean) => {
      if (clientDisposed) {
        return;
      }
      clientDisposed = true;
      client.removeListener('error', onClientError);
      try {
        client.release(destroy);
      } catch (error) {
        // The client was already destroyed by the error path.
        console.error(
          '[v2-adapter-db-postgres-pg] Failed to release table schema coordination client',
          error
        );
      }
    };

    const onClientError = (error: Error) => {
      broken = true;
      console.error(
        '[v2-adapter-db-postgres-pg] Table schema coordination connection failed',
        error
      );
      // Never return a dead connection to the pool. `release()` becomes a
      // no-op because the transaction was already rolled back by PostgreSQL.
      disposeClient(true);
    };
    client.on('error', onClientError);

    try {
      await this.beginHoldingLocks(client, tableIds, mode);
    } catch (error) {
      if (!broken) {
        const rollbackFailed = await client.query('ROLLBACK').then(
          () => false,
          () => true
        );
        disposeClient(rollbackFailed);
      }
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.acquire_failed',
          message: 'Failed to acquire table schema coordination locks',
          details: { tableIds, mode },
          cause: error instanceof Error ? error : undefined,
        })
      );
    }

    if (broken) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.acquire_failed',
          message: 'Failed to acquire table schema coordination locks',
          details: { tableIds, mode },
        })
      );
    }

    return ok(
      createLease(mode, tableIds, async () => {
        if (leaseReleased) {
          return;
        }
        leaseReleased = true;
        if (broken || clientDisposed) {
          return;
        }
        try {
          // Committing releases every advisory xact lock held by this lease.
          await client.query('COMMIT');
          disposeClient(false);
        } catch (error) {
          const rollbackFailed = await client.query('ROLLBACK').then(
            () => false,
            () => true
          );
          disposeClient(rollbackFailed);
          console.error(
            '[v2-adapter-db-postgres-pg] Failed to release table schema coordination locks',
            error
          );
        }
      })
    );
  }

  private async beginHoldingLocks(
    client: PoolClient,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode
  ): Promise<void> {
    const lockFunction =
      mode === 'exclusive' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
    await client.query('BEGIN');
    await client.query("SELECT set_config('application_name', $1, true)", [
      this.options.applicationName ?? DEFAULT_APPLICATION_NAME,
    ]);
    for (const tableId of tableIds) {
      await client.query(`SELECT ${lockFunction}(hashtextextended($1, 0))`, [
        `teable.schema:table:${tableId}`,
      ]);
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    const destroyedError = new Error(POOL_DESTROYED_MESSAGE);
    const pending = Array.from(this.pendingAcquires);
    this.pendingAcquires.clear();
    for (const abort of pending) {
      abort(destroyedError);
    }

    const poolPromise = this.poolPromise;
    this.pool = undefined;
    this.poolPromise = undefined;
    if (!poolPromise) {
      return;
    }
    try {
      const pool = await poolPromise;
      await pool.end();
    } catch (error) {
      console.error('[v2-adapter-db-postgres-pg] Failed to close schema coordination pool', error);
    }
  }

  private async getPool(): Promise<Pool> {
    if (this.pool) {
      return this.pool;
    }
    this.poolPromise ??= this.createPool();
    try {
      return await this.poolPromise;
    } catch (error) {
      this.poolPromise = undefined;
      throw error;
    }
  }

  private async createPool(): Promise<Pool> {
    const pg = await loadPg();
    const poolCtor = pg.Pool ?? (hasPgDefault(pg) ? pg.default.Pool : undefined);
    if (!poolCtor) {
      throw new Error('Missing pg.Pool');
    }
    const pool = new poolCtor({
      connectionString: this.options.connectionString,
      max: this.options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      connectionTimeoutMillis:
        this.options.connectionTimeoutMillis ?? DEFAULT_CONNECTION_TIMEOUT_MILLIS,
    });
    pool.on('error', handlePgPoolError);
    if (this.destroyed) {
      await pool.end();
      throw new Error(POOL_DESTROYED_MESSAGE);
    }
    this.pool = pool;
    return pool;
  }

  /**
   * `pool.end()` never drains pending `connect()` callers, so track them and
   * reject on `destroy()` instead of leaving shutdown hanging.
   */
  private async connectClient(pool: Pool): Promise<PoolClient> {
    if (this.destroyed) {
      throw new Error(POOL_DESTROYED_MESSAGE);
    }

    const deferred = createDeferred<PoolClient>();
    let settled = false;

    const abortPending = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      this.pendingAcquires.delete(abortPending);
      deferred.reject(error);
    };
    this.pendingAcquires.add(abortPending);

    pool.connect().then(
      (client) => {
        if (settled) {
          // `destroy()` already rejected this caller; never leak the client.
          try {
            client.release(true);
          } catch {
            // Already released.
          }
          return;
        }
        settled = true;
        this.pendingAcquires.delete(abortPending);
        deferred.resolve(client);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.pendingAcquires.delete(abortPending);
        deferred.reject(error instanceof Error ? error : new Error(String(error)));
      }
    );

    return deferred.promise;
  }
}
