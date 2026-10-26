/* eslint-disable @typescript-eslint/naming-convention */
// `PgPoolObserver` is the contract name for the DI seam, and the failure-phase table below
// is keyed by PostgreSQL SQLSTATE / node driver codes, not by code style.
import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolClient, PoolConfig } from 'pg';

const prismaOnlySearchParams = [
  'connection_limit',
  'pgbouncer',
  'pool_timeout',
  'schema',
  'statement_cache_size',
] as const;

export const PG_POOL_FACTORY = Symbol('PG_POOL_FACTORY');

export type PgPoolFactory = (config: PoolConfig) => Pool;
export const defaultPgPoolFactory: PgPoolFactory = (config) => new Pool(config);

export interface IPgPoolAcquireOptions {
  applicationName?: string;
  connectionTimeoutMillis?: number;
  max?: number;
  poolName?: string;
  /**
   * Maximum callers already waiting for a client when this request would join
   * pg's pending queue. Reaching the limit rejects immediately instead of
   * growing the queue. `0` disables queueing for this pool; unset keeps pg's
   * unbounded queue.
   */
  queueLimit?: number;
  /**
   * Milliseconds a queued request may wait for a client. pg's
   * `connectionTimeoutMillis` only bounds physical connection setup, so this is
   * the only bound on waiting behind a saturated pool. `0` disables it.
   */
  queueTimeoutMillis?: number;
}

/** Fail fast on TCP connect instead of hanging on OS timeout (~75–130s+). */
export const DEFAULT_PG_POOL_CONNECTION_TIMEOUT_MS = 5000;

/** Rejected before calling pg because the pool already has enough waiters. */
export class PgPoolQueueSaturatedError extends Error {
  readonly code = 'PG_POOL_QUEUE_SATURATED';

  constructor(
    readonly queueLimit: number,
    readonly poolName?: string
  ) {
    super(
      `PostgreSQL pool queue is full (limit ${queueLimit}${
        poolName ? `, pool ${poolName}` : ''
      }); rejecting instead of waiting`
    );
    this.name = 'PgPoolQueueSaturatedError';
  }
}

/**
 * Rejected while waiting for a free client. pg never times out queued callers,
 * so without this a saturated BYODB pool turns into unbounded request latency.
 */
export class PgPoolQueueTimeoutError extends Error {
  readonly code = 'PG_POOL_QUEUE_TIMEOUT';

  constructor(
    readonly timeoutMillis: number,
    readonly poolName?: string
  ) {
    super(
      `Timed out after ${timeoutMillis}ms waiting for a PostgreSQL pool connection${
        poolName ? ` (pool ${poolName})` : ''
      }`
    );
    this.name = 'PgPoolQueueTimeoutError';
  }
}

export interface IPgPoolSnapshot {
  applicationName: string;
  database: string;
  host: string;
  idle: number;
  max: number;
  poolName?: string;
  port?: number;
  references: number;
  total: number;
  waiting: number;
}

export interface IPgPoolLease {
  readonly pool: Pool;
  release(): Promise<void>;
}

/**
 * Which pool observation point saw a failure.
 *
 * - `connect`: establishing a physical connection (DNS/TCP/TLS/auth, or the server
 *   refusing the connection, e.g. `sorry, too many clients already`).
 * - `acquire`: waiting for a free client of an already usable pool.
 *
 * `idle` is not produced here: it is the failure phase of an *established* idle
 * client and only the pg Pool `'error'` event can report it.
 */
export type PgPoolFailurePhase = 'connect' | 'acquire';

/**
 * Observation seam over the process-owned pg pools. Every method is called by the
 * registry inside its own try/catch: an observer must never affect pool behaviour,
 * connection semantics or error propagation, and a broken observer must not be able
 * to break a query. Implementations must stay cheap (no queries, no blocking work).
 */
export interface PgPoolObserver {
  onPoolCreated(snapshot: IPgPoolSnapshot): void;
  onConnectEstablished(snapshot: IPgPoolSnapshot): void;
  onPoolError(snapshot: IPgPoolSnapshot, error: unknown): void;
  onAcquireFailure(
    snapshot: IPgPoolSnapshot,
    error: unknown,
    phase: PgPoolFailurePhase,
    durationMs: number
  ): void;
  onAcquireSettled(
    snapshot: IPgPoolSnapshot,
    phase: PgPoolFailurePhase,
    durationMs: number,
    isError: boolean
  ): void;

  /**
   * Called only when the acquisition joined pg's pending queue instead of being dispensed
   * as an immediate idle checkout or starting its own physical connection. `durationMs` is
   * the time from `connect()` until the client was handed out; if the queued request later
   * needed a replacement physical connection, that setup time is included. Immediate
   * acquisitions never call this method; `onAcquireSettled` remains the complete
   * per-attempt signal.
   */
  onAcquireQueued?(snapshot: IPgPoolSnapshot, durationMs: number, isError: boolean): void;
}

export const PG_POOL_OBSERVER = Symbol('PG_POOL_OBSERVER');

export const noopPgPoolObserver: PgPoolObserver = {
  onPoolCreated: () => undefined,
  onConnectEstablished: () => undefined,
  onPoolError: () => undefined,
  onAcquireFailure: () => undefined,
  onAcquireSettled: () => undefined,
  onAcquireQueued: () => undefined,
};

let activePgPoolObserver: PgPoolObserver | undefined;

/**
 * Install the observer for every pool this process owns.
 *
 * `PrismaModule` is a library module: Nest resolves `PG_POOL_OBSERVER` in the module
 * that declares `PgPoolRegistry`, so an application cannot override it by providing
 * the token again without re-providing `PgPoolRegistry` — which would create a second
 * registry and duplicate physical pools. The app therefore installs its observer once
 * at startup through this hook, and the DI value below (`pgPoolObserverFacade`) keeps
 * delegating to it. Not installed = no-op, which is also the behaviour of a default
 * construction (`new PgPoolRegistry(factory)`).
 */
export const installPgPoolObserver = (observer?: PgPoolObserver): void => {
  activePgPoolObserver = observer;
};

export const getPgPoolObserver = (): PgPoolObserver => activePgPoolObserver ?? noopPgPoolObserver;

/**
 * Provided under `PG_POOL_OBSERVER` by `PrismaModule`. Delegates at call time so an
 * observer installed after module bootstrap is still visible, and stays a no-op
 * (no allocation, no work) when nothing is installed.
 */
export const pgPoolObserverFacade: PgPoolObserver = {
  onPoolCreated: (snapshot) => getPgPoolObserver().onPoolCreated(snapshot),
  onConnectEstablished: (snapshot) => getPgPoolObserver().onConnectEstablished(snapshot),
  onPoolError: (snapshot, error) => getPgPoolObserver().onPoolError(snapshot, error),
  onAcquireFailure: (snapshot, error, phase, durationMs) =>
    getPgPoolObserver().onAcquireFailure(snapshot, error, phase, durationMs),
  onAcquireSettled: (snapshot, phase, durationMs, isError) =>
    getPgPoolObserver().onAcquireSettled(snapshot, phase, durationMs, isError),
  onAcquireQueued: (snapshot, durationMs, isError) =>
    getPgPoolObserver().onAcquireQueued?.(snapshot, durationMs, isError),
};

/** Driver/PG codes that mean the physical connection attempt itself failed. */
const connectPhaseCodes: Record<string, true> = {
  '08000': true,
  '08001': true,
  '08003': true,
  '08004': true,
  '08006': true,
  '08007': true,
  '28000': true,
  '28P01': true,
  '3D000': true,
  '53300': true,
  '53400': true,
  '57P01': true,
  '57P02': true,
  '57P03': true,
  EAI_AGAIN: true,
  ECONNREFUSED: true,
  ECONNRESET: true,
  EHOSTUNREACH: true,
  ENETUNREACH: true,
  ENOTFOUND: true,
  EPIPE: true,
  ETIMEDOUT: true,
};

/** pg-pool message for a connection-attempt timeout, also emitted by Prisma's retry. */
const connectPhaseMessagePattern =
  /timeout exceeded when trying to connect|connection terminated due to connection timeout|connection terminated unexpectedly|getaddrinfo|password authentication failed|could not connect|connection refused/i;

const resolveAcquireFailurePhase = (error: unknown): PgPoolFailurePhase => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && connectPhaseCodes[code]) {
    return 'connect';
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message && connectPhaseMessagePattern.test(message) ? 'connect' : 'acquire';
};

interface IPgPoolEntry {
  applicationName: string;
  database: string;
  host: string;
  key: string;
  max: number;
  pool: Pool;
  poolName?: string;
  port?: number;
  queueLimit?: number;
  queueTimeoutMillis?: number;
  references: number;
}

interface INormalizedPoolConfig {
  connectionString: string;
  database: string;
  host: string;
  key: string;
  max: number;
  poolName?: string;
  port?: number;
  queueLimit?: number;
  queueTimeoutMillis?: number;
}

const parsePositiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseNonNegativeInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * Whether this call must wait for a client instead of checking one out from the
 * idle list or opening a new physical connection.
 */
const wouldJoinPoolQueue = (pool: Pool, max: number): boolean =>
  pool.idleCount === 0 && pool.totalCount >= max;

/**
 * Return a client that arrived after its caller was already failed by the queue
 * timeout. Without this the checked-out connection would leak until shutdown.
 */
const releaseLateClient = (client: unknown, done?: unknown): void => {
  try {
    if (typeof done === 'function') {
      done();
      return;
    }
    if (
      client &&
      typeof client === 'object' &&
      'release' in client &&
      typeof client.release === 'function'
    ) {
      client.release();
    }
  } catch {
    // The pool already disposed the client on the failure path.
  }
};

const resolveConnectionTimeoutMillis = (options: IPgPoolAcquireOptions): number =>
  parseNonNegativeInteger(options.connectionTimeoutMillis) ??
  parseNonNegativeInteger(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS) ??
  DEFAULT_PG_POOL_CONNECTION_TIMEOUT_MS;

const normalizePoolConfig = (
  connectionString: string,
  options: IPgPoolAcquireOptions
): INormalizedPoolConfig => {
  const url = new URL(connectionString);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Unsupported PostgreSQL connection protocol: ${url.protocol}`);
  }
  const max =
    parsePositiveInteger(options.max) ??
    parsePositiveInteger(process.env.DATABASE_POOL_MAX) ??
    parsePositiveInteger(url.searchParams.get('connection_limit')) ??
    20;

  for (const parameter of prismaOnlySearchParams) {
    url.searchParams.delete(parameter);
  }
  url.searchParams.sort();

  const normalizedConnectionString = url.toString();
  const identityUrl = new URL(normalizedConnectionString);
  identityUrl.protocol = 'postgresql:';
  if (!identityUrl.port) identityUrl.port = '5432';
  const queueLimit = parseNonNegativeInteger(options.queueLimit);
  const queueTimeoutMillis = parseNonNegativeInteger(options.queueTimeoutMillis);
  return {
    connectionString: normalizedConnectionString,
    database: url.pathname.replace(/^\//, ''),
    host: url.hostname,
    key: JSON.stringify([identityUrl.toString(), options.poolName ?? null]),
    max,
    ...(options.poolName !== undefined ? { poolName: options.poolName } : {}),
    port: Number(url.port || 5432),
    ...(queueLimit !== undefined ? { queueLimit } : {}),
    ...(queueTimeoutMillis !== undefined && queueTimeoutMillis > 0 ? { queueTimeoutMillis } : {}),
  };
};

@Injectable()
export class PgPoolRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(PgPoolRegistry.name);
  private readonly entries = new Map<string, IPgPoolEntry>();
  private shuttingDown = false;

  constructor(
    @Inject(PG_POOL_FACTORY)
    private readonly poolFactory: PgPoolFactory,
    // Optional: `new PgPoolRegistry(factory)` stays a valid construction and means
    // "observe nothing"; the observer is never required for pool correctness.
    @Optional()
    @Inject(PG_POOL_OBSERVER)
    private readonly observer?: PgPoolObserver
  ) {}

  acquire(connectionString: string, options: IPgPoolAcquireOptions = {}): IPgPoolLease {
    if (this.shuttingDown) {
      throw new Error('PostgreSQL pool registry is shutting down');
    }

    const normalized = normalizePoolConfig(connectionString, options);
    let entry = this.entries.get(normalized.key);
    if (!entry) {
      const applicationName = options.applicationName ?? 'teable';
      const pool = this.poolFactory({
        application_name: applicationName,
        connectionString: normalized.connectionString,
        connectionTimeoutMillis: resolveConnectionTimeoutMillis(options),
        max: normalized.max,
      });
      const created: IPgPoolEntry = {
        applicationName,
        database: normalized.database,
        host: normalized.host,
        key: normalized.key,
        max: normalized.max,
        pool,
        ...(normalized.poolName !== undefined ? { poolName: normalized.poolName } : {}),
        port: normalized.port,
        ...(normalized.queueLimit !== undefined ? { queueLimit: normalized.queueLimit } : {}),
        ...(normalized.queueTimeoutMillis !== undefined
          ? { queueTimeoutMillis: normalized.queueTimeoutMillis }
          : {}),
        references: 0,
      };
      this.entries.set(normalized.key, created);
      this.observePool(created);
      this.notifyObservers((observer) => observer.onPoolCreated(this.toSnapshot(created)));
      entry = created;
    } else if (entry.max !== normalized.max) {
      this.logger.warn(
        `Reusing PostgreSQL pool ${entry.host}/${entry.database} with max=${entry.max}; ignored requested max=${normalized.max}`
      );
    }

    entry.references += 1;
    let released = false;
    return {
      pool: entry.pool,
      release: async () => {
        if (released) return;
        released = true;
        await this.release(entry!);
      },
    };
  }

  snapshot(): IPgPoolSnapshot[] {
    return Array.from(this.entries.values())
      .map((entry) => this.toSnapshot(entry))
      .sort((left, right) =>
        `${left.host}:${left.port ?? ''}/${left.database}/${left.poolName ?? ''}`.localeCompare(
          `${right.host}:${right.port ?? ''}/${right.database}/${right.poolName ?? ''}`
        )
      );
  }

  private toSnapshot(entry: IPgPoolEntry): IPgPoolSnapshot {
    return {
      applicationName: entry.applicationName,
      database: entry.database,
      host: entry.host,
      idle: entry.pool.idleCount,
      max: entry.max,
      ...(entry.poolName !== undefined ? { poolName: entry.poolName } : {}),
      ...(entry.port ? { port: entry.port } : {}),
      references: entry.references,
      total: entry.pool.totalCount,
      waiting: entry.pool.waitingCount,
    };
  }

  /** Observation must never change pool behaviour, so every call is isolated. */
  private notifyObservers(run: (observer: PgPoolObserver) => void): void {
    try {
      run(this.observer ?? noopPgPoolObserver);
    } catch {
      // A broken observer is a monitoring problem, never a connection problem.
    }
  }

  /**
   * Attach the pool-level seam: idle client failures, physical connection
   * establishments, and a timing wrapper around `connect()`.
   *
   * The wrapper calls the (already instrumented) `connect` and only observes the
   * result: same resolution value, same rejection, same callbacks. Callback-style
   * (`connect(cb)`) and promise-style (`connect()`, what Prisma's pg adapter uses)
   * are both measured, and every attempt is its own observation — Prisma retries a
   * connection timeout once, so one logical `connect` can legitimately produce two
   * observations that must not be merged.
   */
  private observePool(entry: IPgPoolEntry): void {
    const pool = entry.pool;
    pool.on?.('error', (error) => {
      this.logger.error(
        `Unexpected idle PostgreSQL pool error for ${entry.host}/${entry.database}`,
        error instanceof Error ? error.stack : undefined
      );
      this.notifyObservers((observer) => observer.onPoolError(this.toSnapshot(entry), error));
    });
    pool.on?.('connect', () => {
      this.notifyObservers((observer) => observer.onConnectEstablished(this.toSnapshot(entry)));
    });

    const originalConnect: unknown = Reflect.get(pool, 'connect');
    if (typeof originalConnect !== 'function') {
      return;
    }

    // `connect` is invoked with the pool as its receiver, so the reporting callback is
    // bound to the registry up front instead of aliasing `this`.
    const reportAcquireOutcome = this.reportAcquireOutcome.bind(this, entry);
    const saturationError = (): Error | undefined => {
      if (entry.queueLimit === undefined || !wouldJoinPoolQueue(pool, entry.max)) {
        return undefined;
      }
      return pool.waitingCount >= entry.queueLimit
        ? new PgPoolQueueSaturatedError(entry.queueLimit, entry.poolName)
        : undefined;
    };

    const observedConnect = function (this: Pool, ...args: unknown[]): unknown {
      const startedAt = Date.now();
      const waitingBefore = pool.waitingCount;
      let queued = false;
      const callback = typeof args[0] === 'function' ? args[0] : undefined;
      const settle = (error: unknown): void => reportAcquireOutcome(queued, startedAt, error);
      const shouldWaitForClient = wouldJoinPoolQueue(pool, entry.max);
      const failFast = saturationError();
      if (failFast) {
        reportAcquireOutcome(false, startedAt, failFast);
        if (typeof callback === 'function') {
          callback.call(undefined, failFast);
          return undefined;
        }
        return Promise.reject(failFast);
      }
      const timeoutMs = shouldWaitForClient ? entry.queueTimeoutMillis : undefined;

      if (typeof callback === 'function') {
        let timedOut = false;
        let timeout: NodeJS.Timeout | undefined;
        const observedCallback = function (this: unknown, ...callbackArgs: unknown[]): unknown {
          if (timeout !== undefined) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          if (timedOut) {
            releaseLateClient(callbackArgs[1], callbackArgs[2]);
            return undefined;
          }
          settle(callbackArgs[0]);
          return callback.apply(this, callbackArgs);
        };
        const result = Reflect.apply(originalConnect, this, [observedCallback]);
        queued = didJoinPoolQueue(pool, waitingBefore);
        if (timeoutMs !== undefined && queued) {
          timeout = setTimeout(() => {
            timeout = undefined;
            timedOut = true;
            const error = new PgPoolQueueTimeoutError(timeoutMs, entry.poolName);
            reportAcquireOutcome(queued, startedAt, error);
            callback.call(undefined, error);
          }, timeoutMs);
          timeout.unref?.();
        }
        return result;
      }

      const result = Reflect.apply(originalConnect, this, args);
      queued = didJoinPoolQueue(pool, waitingBefore);
      if (!(result instanceof Promise)) {
        return result;
      }
      if (timeoutMs === undefined || !queued) {
        return result.then(
          (value) => {
            settle(undefined);
            return value;
          },
          (error: unknown) => {
            settle(error);
            throw error;
          }
        );
      }

      let timedOut = false;
      let timeout: NodeJS.Timeout | undefined;
      const queueTimeout = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timeout = undefined;
          timedOut = true;
          const error = new PgPoolQueueTimeoutError(timeoutMs, entry.poolName);
          reportAcquireOutcome(queued, startedAt, error);
          reject(error);
        }, timeoutMs);
        timeout.unref?.();
      });
      // The pool eventually hands out the client this call asked for; returning it
      // is the only way to avoid leaking a checked-out connection after the timeout.
      void result.then(
        (value) => {
          if (timedOut) releaseLateClient(value);
        },
        () => undefined
      );
      return Promise.race([result, queueTimeout]).then(
        (value) => {
          clearTimeout(timeout);
          settle(undefined);
          return value;
        },
        (error: unknown) => {
          clearTimeout(timeout);
          if (!timedOut) settle(error);
          throw error;
        }
      );
    };

    Reflect.set(pool, 'connect', observedConnect);
  }

  /**
   * Reports one settled acquisition attempt. Settlement is reported before failure so a
   * throwing settle listener cannot swallow the failure detail (and vice versa: each
   * notification has its own guard).
   */
  private reportAcquireOutcome(
    entry: IPgPoolEntry,
    queuedAtEntry: boolean,
    startedAt: number,
    error: unknown
  ): void {
    const durationMs = Date.now() - startedAt;
    const phase = resolveAcquireFailurePhase(error);
    const snapshot = this.toSnapshot(entry);
    this.notifyObservers((observer) =>
      observer.onAcquireSettled(snapshot, phase, durationMs, error != null)
    );
    if (queuedAtEntry) {
      this.notifyObservers((observer) =>
        observer.onAcquireQueued?.(snapshot, durationMs, error != null)
      );
    }
    if (error != null) {
      this.notifyObservers((observer) =>
        observer.onAcquireFailure(snapshot, error, phase, durationMs)
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(entries.map((entry) => entry.pool.end()));
  }

  private async release(entry: IPgPoolEntry): Promise<void> {
    const current = this.entries.get(entry.key);
    if (current !== entry) return;

    current.references -= 1;
    if (current.references > 0) return;

    this.entries.delete(entry.key);
    await entry.pool.end();
  }
}

/**
 * Whether this `connect()` call was appended to pg's pending queue without an idle client
 * available for it. pg appends synchronously and only dispenses idle clients on the next
 * pulse, so `waitingCount` still includes this call; its queue position is
 * `waitingAfter - 1`, and it is queued when that position is not covered by `idleCount`.
 * A call that starts a physical connection does not change `waitingCount`.
 */
const didJoinPoolQueue = (pool: Pool, waitingBefore: number): boolean => {
  const waitingAfter = pool.waitingCount;
  return waitingAfter > waitingBefore && waitingAfter - 1 >= pool.idleCount;
};
