import { getPostgresTransaction, pgErrorCode } from '@teable/v2-adapter-db-postgres-shared';
import {
  createTableSchemaCoordinationLease,
  domainError,
  resolveScopedTableSchemaLease,
  type DomainError,
  type IExecutionContext,
} from '@teable/v2-core';
import { sql } from 'kysely';
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
  /** Positive local admission and PostgreSQL advisory-lock wait bound. Defaults to 3000ms. */
  lockTimeoutMillis?: number;
  /** Transaction-local `application_name` while a coordination lease is held. */
  applicationName?: string;
}

const DEFAULT_MAX_CONNECTIONS = 8;
const DEFAULT_CONNECTION_TIMEOUT_MILLIS = 10_000;
const DEFAULT_LOCK_TIMEOUT_MILLIS = 3_000;
const DEFAULT_APPLICATION_NAME = 'teable-v2-schema-coordination';
const POOL_DESTROYED_MESSAGE = 'Table schema coordination pool has been destroyed';

const tableSchemaLockKey = (tableId: string): string => `teable.schema:table:${tableId}`;

const cancelledError = () =>
  domainError.infrastructure({
    code: 'schema_coordination.cancelled',
    message: 'Table schema coordination acquisition cancelled',
  });

const destroyedError = () =>
  domainError.infrastructure({
    code: 'schema_coordination.pool_destroyed',
    message: POOL_DESTROYED_MESSAGE,
  });

type CoordinationMode = 'shared' | 'exclusive';

const busyError = (tableIds: ReadonlyArray<string>, mode: CoordinationMode, cause?: Error) =>
  domainError.conflict({
    code: 'schema_coordination.busy',
    message: 'Table schema coordination is waiting for an active operation; retry the request',
    details: { tableIds, mode },
    cause,
  });

interface ITableWaiter {
  mode: CoordinationMode;
  settle(error?: DomainError): void;
}

interface ITableAdmissions {
  mode: CoordinationMode;
  holders: number;
  waiters: Set<ITableWaiter>;
}

export interface ICoordinationLease {
  readonly mode: CoordinationMode;
  readonly tableIds: ReadonlyArray<string>;
  readonly fence?: { backendPid: number; transactionId: string };
  readonly isActive?: boolean;
  assertHeld?(): Promise<Result<void, DomainError>>;
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
    private readonly protocol: PostgresProtocolConnectionConstructor,
    private readonly onDispose: (checkout: CoordinationCheckout) => void
  ) {
    this.client.on('error', this.onClientError);
    this.client.on('end', this.onClientEnd);
  }

  private readonly onClientError = (error: Error): void => {
    this.broken = true;
    console.error('[v2-adapter-db-postgres-pg] Table schema coordination connection failed', error);
    // Never return a dead connection to the pool. `release()` becomes a
    // no-op because the transaction was already rolled back by PostgreSQL.
    this.dispose(true);
  };

  private readonly onClientEnd = (): void => {
    this.destroy();
  };

  get isActive(): boolean {
    return !this.released && !this.broken && !this.disposed;
  }

  destroy(): void {
    this.broken = true;
    // Retiring the coordinator must roll back waiters and held leases, never commit them.
    this.dispose(true);
  }

  async assertHeld(fence: {
    backendPid: number;
    transactionId: string;
  }): Promise<Result<void, DomainError>> {
    if (this.isActive) {
      try {
        const proof = await this.client.query<{ held: boolean }>(
          'SELECT pg_backend_pid() = $1 AND pg_current_xact_id()::text = $2 AS held',
          [fence.backendPid, fence.transactionId]
        );
        if (proof.rows[0]?.held && this.isActive) return ok(undefined);
      } catch {
        this.destroy();
      }
    }
    return err(
      domainError.conflict({
        code: 'actor_columns.lease_lost',
        message: 'Record attribution schema lease was lost',
      })
    );
  }

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
    this.onDispose(this);
    this.client.removeListener('error', this.onClientError);
    this.client.removeListener('end', this.onClientEnd);
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
    if (this.broken || this.disposed) return;
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
 * Conflicting single-table requests queue locally before pool checkout.
 * Shared requests can still hold concurrent leases. PostgreSQL coordinates
 * across processes and with multi-table requests.
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
  /** Includes lock waiters and held leases, not only callers queued in pool.connect(). */
  private readonly checkedOutClients = new Set<CoordinationCheckout>();
  private readonly tableAdmissions = new Map<string, ITableAdmissions>();

  constructor(private readonly options: IV2PgTableSchemaCoordinationOptions) {}

  async acquire(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode,
    signal?: AbortSignal
  ): Promise<Result<ICoordinationLease, DomainError>> {
    if (signal?.aborted) return err(cancelledError());
    const scoped = resolveScopedTableSchemaLease(context, tableIds, mode);
    if (scoped) return scoped;
    const requested = Array.from(new Set(tableIds)).sort();
    if (requested.length === 0) {
      return ok(createLease(mode, []));
    }
    if (this.destroyed) return err(destroyedError());
    const lockTimeoutMillis = this.options.lockTimeoutMillis ?? DEFAULT_LOCK_TIMEOUT_MILLIS;
    if (!Number.isInteger(lockTimeoutMillis) || lockTimeoutMillis <= 0) {
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.acquire_failed',
          message: 'Failed to acquire table schema coordination locks',
          details: { tableIds: requested, mode },
          cause: new Error('Table schema coordination lock timeout must be a positive integer'),
        })
      );
    }
    if (requested.length !== 1) {
      return this.acquireLocks(context, requested, mode, lockTimeoutMillis, signal);
    }

    const tableId = requested[0]!;
    const admission = await this.waitForTable(tableId, mode, lockTimeoutMillis, signal);
    if (admission.isErr()) return err(admission.error);

    let lease: ICoordinationLease | undefined;
    try {
      if (signal?.aborted) return err(cancelledError());
      const result = await this.acquireLocks(context, requested, mode, lockTimeoutMillis, signal);
      if (result.isErr()) return result;
      lease = result.value;
    } finally {
      if (!lease) this.releaseTable(tableId, admission.value);
    }

    const acquired = lease;
    let released = false;
    return ok({
      mode: acquired.mode,
      tableIds: acquired.tableIds,
      fence: acquired.fence,
      get isActive() {
        return acquired.isActive;
      },
      assertHeld: acquired.assertHeld,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await acquired.release();
        } finally {
          this.releaseTable(tableId, admission.value);
        }
      },
    });
  }

  async tryAcquireInTransaction(
    context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode
  ): Promise<Result<ICoordinationLease, DomainError>> {
    if (context.abortSignal?.aborted) return err(cancelledError());
    if (this.destroyed) return err(destroyedError());
    const requested = Array.from(new Set(tableIds)).sort();
    if (requested.length === 0) return ok(createTableSchemaCoordinationLease(mode, []));
    // The dedicated coordinator connects to the metadata database. Only use a
    // transaction bound to that scope, including a same-database data batch.
    const transaction = getPostgresTransaction(context, 'meta');
    if (!transaction) {
      return err(
        domainError.invariant({
          code: 'schema_coordination.transaction_already_started',
          message: 'Nonblocking schema coordination requires a metadata transaction',
        })
      );
    }
    const tryLock =
      mode === 'exclusive' ? 'pg_try_advisory_xact_lock' : 'pg_try_advisory_xact_lock_shared';
    const keys = requested.map(tableSchemaLockKey);
    const { rows } = await sql<{ locked: boolean }>`
      SELECT bool_and(${sql.raw(tryLock)}(hashtextextended(key, 0))) AS locked
      FROM unnest(${keys}::text[]) AS keys(key)
    `.execute(transaction);
    if (!rows[0]?.locked) return err(busyError(requested, mode));
    // PostgreSQL owns these locks until the outer transaction ends.
    return ok(createTableSchemaCoordinationLease(mode, requested));
  }

  private async waitForTable(
    tableId: string,
    mode: CoordinationMode,
    lockTimeoutMillis: number,
    signal?: AbortSignal
  ): Promise<Result<ITableAdmissions, DomainError>> {
    const state = this.tableAdmissions.get(tableId);
    if (!state) {
      const initial = { mode, holders: 1, waiters: new Set<ITableWaiter>() };
      this.tableAdmissions.set(tableId, initial);
      return ok(initial);
    }
    if (mode === 'shared' && state.mode === 'shared' && !state.waiters.size) {
      state.holders += 1;
      return ok(state);
    }

    return new Promise((resolve) => {
      const waiter: ITableWaiter = {
        mode,
        settle: (error) => {
          clearTimeout(timeout);
          state.waiters.delete(waiter);
          signal?.removeEventListener('abort', onAbort);
          resolve(error ? err(error) : ok(state));
        },
      };
      const fail = (error: DomainError) => {
        waiter.settle(error);
        this.admitWaiters(tableId, state);
      };
      const onAbort = () => fail(cancelledError());
      const timeout = setTimeout(() => fail(busyError([tableId], mode)), lockTimeoutMillis);
      state.waiters.add(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private releaseTable(tableId: string, state: ITableAdmissions): void {
    state.holders -= 1;
    this.admitWaiters(tableId, state);
  }

  private admitWaiters(tableId: string, state: ITableAdmissions): void {
    if (this.destroyed) return;
    for (const waiter of state.waiters) {
      if (state.holders && (state.mode === 'exclusive' || waiter.mode === 'exclusive')) return;
      state.mode = waiter.mode;
      state.holders += 1;
      waiter.settle();
    }
    if (!state.holders) this.tableAdmissions.delete(tableId);
  }

  private async acquireLocks(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: CoordinationMode,
    lockTimeoutMillis: number,
    signal?: AbortSignal
  ): Promise<Result<ICoordinationLease, DomainError>> {
    if (this.destroyed) return err(destroyedError());

    const client = await this.checkoutCoordinationClient(signal);
    if (client.isErr()) return err(client.error);
    if (signal?.aborted) {
      client.value.release(true);
      return err(cancelledError());
    }

    const checkout = new CoordinationCheckout(
      client.value,
      this.connectionConstructor,
      (disposed) => {
        this.checkedOutClients.delete(disposed);
      }
    );
    this.checkedOutClients.add(checkout);
    if (this.destroyed) {
      checkout.destroy();
      return err(
        domainError.infrastructure({
          code: 'schema_coordination.pool_destroyed',
          message: POOL_DESTROYED_MESSAGE,
        })
      );
    }
    let fence!: { backendPid: number; transactionId: string };
    const attempt = await checkout.attempt(signal, async () => {
      await this.beginHoldingLocks(client.value, tableIds, mode, lockTimeoutMillis, signal);
      const proof = await client.value.query<{ backendPid: number; transactionId: string }>(
        'SELECT pg_backend_pid() AS "backendPid", pg_current_xact_id()::text AS "transactionId"'
      );
      fence = {
        backendPid: proof.rows[0].backendPid,
        transactionId: proof.rows[0].transactionId,
      };
    });
    if (signal?.aborted) {
      checkout.dispose(true);
      return err(cancelledError());
    }
    if (attempt.failed) {
      await checkout.rollbackUnlessBroken();
      if (pgErrorCode(attempt.error) === '55P03') {
        return err(
          busyError(tableIds, mode, attempt.error instanceof Error ? attempt.error : undefined)
        );
      }
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
    return ok({
      mode,
      tableIds,
      fence,
      get isActive() {
        return checkout.isActive;
      },
      assertHeld: () => checkout.assertHeld(fence),
      release: () => checkout.release(),
    });
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
    lockTimeoutMillis: number,
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
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMillis}ms`]);
    for (const tableId of tableIds) {
      signal?.throwIfAborted();
      await client.query(`SELECT ${lockFunction}(hashtextextended($1, 0))`, [
        tableSchemaLockKey(tableId),
      ]);
    }
    signal?.throwIfAborted();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    const shutdownError = new Error(POOL_DESTROYED_MESSAGE);
    for (const { waiters } of this.tableAdmissions.values()) {
      for (const waiter of waiters) waiter.settle(destroyedError());
    }
    this.tableAdmissions.clear();
    const pending = Array.from(this.pendingAcquires);
    this.pendingAcquires.clear();
    for (const abort of pending) {
      abort(shutdownError);
    }
    // pool.end() waits for checked-out clients. A lock waiter can be waiting on
    // the very exclusive lease whose owner is retiring this cached container.
    // Abort those queries and invalidate held lease proofs before draining.
    for (const checkout of Array.from(this.checkedOutClients)) checkout.destroy();

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
