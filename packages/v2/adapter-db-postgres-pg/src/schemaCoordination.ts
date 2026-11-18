import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import { cancelPostgresQuery, type PostgresProtocolConnectionConstructor } from './cancelRequest';
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

const cancelledError = () =>
  domainError.infrastructure({
    code: 'schema_coordination.cancelled',
    message: 'Table schema coordination acquisition cancelled',
  });

type CoordinationMode = 'shared' | 'exclusive';

export interface ICoordinationLease {
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

interface ILockAttempt {
  readonly failed: boolean;
  readonly error?: unknown;
}

/** One coordination checkout. Cancellation covers acquisition only; release commits the lease. */
class CoordinationCheckout {
  private disposed = false;
  private released = false;
  private acquiring = true;
  private cancellationPending: Promise<void> | undefined;
  broken = false;

  constructor(
    private readonly client: PoolClient,
    private readonly protocol: PostgresProtocolConnectionConstructor
  ) {
    this.client.on('error', this.onClientError);
  }

  private readonly onClientError = (error: Error): void => {
    this.broken = true;
    console.error('[v2-adapter-db-postgres-pg] Table schema coordination connection failed', error);
    // Never return a dead connection to the pool. `release()` becomes a
    // no-op because the transaction was already rolled back by PostgreSQL.
    this.dispose(true);
  };

  private readonly onAbort = (): void => {
    // Closing a socket alone need not wake a backend blocked on an advisory
    // lock. Observe both its CancelRequest and the original query before
    // retiring this checkout; never reuse it for another statement.
    this.cancellationPending ??= cancelPostgresQuery(
      this.client,
      this.protocol,
      () => this.acquiring && !this.disposed
    ).catch(() => undefined);
  };

  dispose(destroy: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.client.removeListener('error', this.onClientError);
    try {
      this.client.release(destroy);
    } catch (error) {
      // The client was already destroyed by the error path.
      console.error(
        '[v2-adapter-db-postgres-pg] Failed to release table schema coordination client',
        error
      );
    }
  }

  async attempt(signal: AbortSignal | undefined, work: () => Promise<void>): Promise<ILockAttempt> {
    if (signal) signal.addEventListener('abort', this.onAbort, { once: true });
    let failed = false;
    let error: unknown;
    try {
      await work();
    } catch (caught) {
      failed = true;
      error = caught;
    } finally {
      this.acquiring = false;
      // The acquisition signal must not release a successfully granted lease.
      if (signal) signal.removeEventListener('abort', this.onAbort);
      if (this.cancellationPending) await this.cancellationPending;
    }
    return failed ? { failed: true, error } : { failed: false };
  }

  async rollbackUnlessBroken(): Promise<void> {
    if (this.broken) return;
    const rollbackFailed = await this.client.query('ROLLBACK').then(
      () => false,
      () => true
    );
    this.dispose(rollbackFailed);
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.broken || this.disposed) return;
    try {
      // Committing releases every advisory xact lock held by this lease.
      await this.client.query('COMMIT');
      this.dispose(false);
    } catch (error) {
      const rollbackFailed = await this.client.query('ROLLBACK').then(
        () => false,
        () => true
      );
      this.dispose(rollbackFailed);
      console.error(
        '[v2-adapter-db-postgres-pg] Failed to release table schema coordination locks',
        error
      );
    }
  }
}

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
  // Initialized with the pool before its first checkout.
  private connectionConstructor!: PostgresProtocolConnectionConstructor;
  private destroyed = false;
  private readonly pendingAcquires = new Set<(error: Error) => void>();

  constructor(private readonly options: IV2PgTableSchemaCoordinationOptions) {}

  async acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode,
    signal?: AbortSignal
  ): Promise<Result<ICoordinationLease, DomainError>> {
    if (signal?.aborted) return err(cancelledError());
    const requested = Array.from(new Set(tableIds)).sort();
    if (requested.length === 0) {
      return ok(createLease(mode, []));
    }
    return this.acquireLocks(context, requested, mode, signal);
  }

  private async acquireLocks(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode,
    signal?: AbortSignal
  ): Promise<Result<ICoordinationLease, DomainError>> {
    if (this.destroyed) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.pool_destroyed',
          message: POOL_DESTROYED_MESSAGE,
        })
      );
    }

    const client = await this.checkoutCoordinationClient(signal);
    if (client.isErr()) return err(client.error);
    if (signal?.aborted) {
      client.value.release(true);
      return err(cancelledError());
    }

    const checkout = new CoordinationCheckout(client.value, this.connectionConstructor);
    const attempt = await checkout.attempt(signal, () =>
      this.beginHoldingLocks(client.value, tableIds, mode, signal)
    );
    if (signal?.aborted) {
      checkout.dispose(true);
      return err(cancelledError());
    }
    if (attempt.failed) {
      await checkout.rollbackUnlessBroken();
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.acquire_failed',
          message: 'Failed to acquire table schema coordination locks',
          details: { tableIds, mode },
          cause: attempt.error instanceof Error ? attempt.error : undefined,
        })
      );
    }
    if (checkout.broken) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.acquire_failed',
          message: 'Failed to acquire table schema coordination locks',
          details: { tableIds, mode },
        })
      );
    }
    return ok(createLease(mode, tableIds, () => checkout.release()));
  }

  private async checkoutCoordinationClient(
    signal?: AbortSignal
  ): Promise<Result<PoolClient, DomainError>> {
    let pool: Pool;
    try {
      pool = await this.getPool();
    } catch (error) {
      if (signal?.aborted) return err(cancelledError());
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.connect_failed',
          message: 'Failed to create the table schema coordination pool',
          cause: error instanceof Error ? error : undefined,
        })
      );
    }

    try {
      return ok(await this.connectClient(pool, signal));
    } catch (error) {
      if (signal?.aborted) return err(cancelledError());
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.connect_failed',
          message: 'Failed to acquire a table schema coordination connection',
          cause: error instanceof Error ? error : undefined,
        })
      );
    }
  }

  private async beginHoldingLocks(
    client: PoolClient,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode,
    signal?: AbortSignal
  ): Promise<void> {
    const lockFunction =
      mode === 'exclusive' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
    signal?.throwIfAborted();
    await client.query('BEGIN');
    signal?.throwIfAborted();
    await client.query("SELECT set_config('application_name', $1, true)", [
      this.options.applicationName ?? DEFAULT_APPLICATION_NAME,
    ]);
    for (const tableId of tableIds) {
      signal?.throwIfAborted();
      await client.query(`SELECT ${lockFunction}(hashtextextended($1, 0))`, [
        `teable.schema:table:${tableId}`,
      ]);
    }
    signal?.throwIfAborted();
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
    const protocolConnection =
      pg.Connection ?? (hasPgDefault(pg) ? pg.default.Connection : undefined);
    if (!protocolConnection) throw new Error('Missing pg.Connection');
    // pg's public declaration omits the runtime protocol constructor signature.
    this.connectionConstructor =
      protocolConnection as unknown as PostgresProtocolConnectionConstructor;
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
  private async connectClient(pool: Pool, signal?: AbortSignal): Promise<PoolClient> {
    if (this.destroyed) {
      throw new Error(POOL_DESTROYED_MESSAGE);
    }
    if (signal?.aborted) throw new Error('Table schema coordination acquisition cancelled');

    const deferred = createDeferred<PoolClient>();
    let settled = false;

    const abortPending = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      this.pendingAcquires.delete(abortPending);
      if (onAbort) signal!.removeEventListener('abort', onAbort);
      deferred.reject(error);
    };
    const onAbort = signal
      ? () => abortPending(new Error('Table schema coordination acquisition cancelled'))
      : undefined;
    this.pendingAcquires.add(abortPending);
    if (onAbort) {
      signal!.addEventListener('abort', onAbort, { once: true });
      if (signal!.aborted) {
        onAbort();
        return deferred.promise;
      }
    }

    pool.connect().then(
      (client) => {
        if (settled) {
          // Cancellation or destroy already rejected this caller; never leak a late checkout.
          try {
            client.release(true);
          } catch {
            // Already released.
          }
          return;
        }
        settled = true;
        this.pendingAcquires.delete(abortPending);
        if (onAbort) signal!.removeEventListener('abort', onAbort);
        deferred.resolve(client);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.pendingAcquires.delete(abortPending);
        if (onAbort) signal!.removeEventListener('abort', onAbort);
        deferred.reject(error instanceof Error ? error : new Error(String(error)));
      }
    );

    return deferred.promise;
  }
}
