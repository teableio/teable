import type { IPgPoolAcquireOptions } from '@teable/db-main-prisma';

/**
 * Per-database connection budget for BYODB data pools.
 *
 * A process-owned pool is keyed by physical database (`host:port/db`), so one app
 * pod holds one data pool per BYODB database. With `appPods` replicas and
 * `databases` databases on the same customer PostgreSQL server, Teable can open:
 *
 *   connections = appPods × databases × (dataPoolMax + auxiliaryReserve)
 *
 * The auxiliary reserve covers the independent pools that can connect to the same
 * database concurrently with the request pool:
 *
 * - domain-event maintenance (`domain-event-outbox-relay.service.ts`, max 1)
 * - domain-event probe (`peekDueDomainEventWork`, independent Knex pool, max 1)
 *
 * Table-query observation is not part of this reserve: its runtime resolves the
 * meta connection string, so it consumes meta capacity even for BYODB containers.
 *
 * The customer server must keep room for other clients and maintenance, so
 * Teable's share is capped at 80% of `max_connections`. Per pod and database:
 *
 *   perPodDbBudget = floor(max_connections × 0.8 / (appPods × databases))
 *   dataPoolMax     = perPodDbBudget - auxiliaryReserve
 *
 * `max_connections` is the only input that can raise the pool above the
 * historical hard-coded size, and the formula above bounds it. The formula needs
 * all three inputs: guessing `appPods` or `databases` as 1 would let every pod
 * size itself as if it were alone, so an incomplete topology keeps the legacy
 * defaults instead.
 *
 * The data-pool size matters because connection demand is Little's law: at the
 * observed 25 rps with a ~0.4 s pooled hold and up to two concurrent connections
 * per write, p95 demand is ~5.8 connections before any burst; 20 per pod gives
 * roughly 3× burst headroom for the single-database BYODB case.
 *
 * The schema-coordination pool is **not** part of this formula: it connects to
 * the meta connection string, not to the customer database. Its size is a
 * meta-server budget (`pods × warm containers × maxConnections ≤ meta
 * max_connections × 0.8`) and is documented on the coordination resolver below.
 */

export const BYODB_POOL_CONNECTION_BUDGET_RATIO = 0.8;
/** Legacy per-database data-pool size used when the budget is unknown. */
export const DEFAULT_BYODB_DATA_DB_POOL_MAX = 5;
/** Burst-headroom target applied when the formula allows it. */
export const TARGET_BYODB_DATA_DB_POOL_MAX = 20;
/** Auxiliary pools that can connect to the same customer database beside the request pool. */
export const BYODB_AUXILIARY_POOL_RESERVE = 2;
/** Legacy coordination pool size used when no owner declares a size. */
export const DEFAULT_BYODB_SCHEMA_COORDINATION_MAX_CONNECTIONS = 8;
/**
 * Coordination pool size for BYODB containers. A held lease pins one connection
 * for the whole coordinated write, including any wait for a data connection; the
 * retest showed 8 slots turning a short data-pool queue into coordination
 * acquire failures, while a healthy acquire stayed under 1 s.
 */
export const TARGET_BYODB_SCHEMA_COORDINATION_MAX_CONNECTIONS = 32;
/**
 * A coordination acquire on a warm pool is sub-millisecond; the observed p99 on a
 * healthy pod was under 1 s. Failing fast sheds a saturated pod in seconds
 * instead of pinning request threads behind a 10 s wait.
 */
export const DEFAULT_BYODB_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS = 2_000;
/**
 * Bounds a caller's wait behind a saturated data pool. pg's own
 * `connectionTimeoutMillis` also fails queued callers, but this guard is
 * shorter, typed (`PG_POOL_QUEUE_TIMEOUT`) and is what keeps a held coordination
 * lease from spanning a multi-second pool wait.
 */
export const DEFAULT_BYODB_DATA_DB_QUEUE_TIMEOUT_MS = 2_000;

export interface IByodbConnectionBudget {
  /** Customer PostgreSQL `max_connections`, when the deployment declares it. */
  maxConnections: number;
  /** App replicas that open pools against the same customer server. */
  appNodes: number;
  /** Databases on the server; each one owns a separate pool. */
  databasesPerServer: number;
  /** `floor(max_connections × 0.8)`, the connection share reserved for Teable. */
  connectionLimit: number;
  /** Connections available to one pod for one database, maintenance included. */
  perPodDbBudget: number;
  /** Data connections derived for one pool after the maintenance reserve. */
  dataPoolMaxConnections: number;
  /** True when the formula could not leave room for anything above one connection. */
  belowMinimum: boolean;
}

export interface IByodbDataDbPoolSettings extends Pick<
  IPgPoolAcquireOptions,
  'max' | 'queueLimit' | 'queueTimeoutMillis'
> {
  budget?: IByodbConnectionBudget;
  /** Explicit `BYODB_DATA_DB_POOL_MAX`; used as the upper bound when present. */
  explicitMax?: number;
  /** Which input decided `max`. */
  source: 'default' | 'explicit' | 'formula';
}

export interface IByodbSchemaCoordinationSettings {
  maxConnections: number;
  connectionTimeoutMillis: number;
  source: 'default' | 'explicit' | 'formula';
}

const parsePositiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseNonNegativeInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const resolveBudget = (
  env: Record<string, string | undefined>
): IByodbConnectionBudget | undefined => {
  const maxConnections = parsePositiveInteger(env.BYODB_DATA_DB_PG_MAX_CONNECTIONS);
  const appNodes = parsePositiveInteger(env.BYODB_APP_NODES);
  const databasesPerServer = parsePositiveInteger(env.BYODB_DATA_DB_DATABASES_PER_SERVER);
  // A partial topology must not be completed by guessing: one pod would then size
  // itself as if it owned the whole customer server.
  if (maxConnections === undefined || appNodes === undefined || databasesPerServer === undefined) {
    return undefined;
  }

  const connectionLimit = Math.floor(maxConnections * BYODB_POOL_CONNECTION_BUDGET_RATIO);
  const perPodDbBudget = Math.floor(connectionLimit / (appNodes * databasesPerServer));
  // A pool cannot be smaller than one connection, so preserve availability and
  // surface the impossible budget in the snapshot instead of failing startup.
  const dataPoolMaxConnections = Math.max(1, perPodDbBudget - BYODB_AUXILIARY_POOL_RESERVE);
  return {
    maxConnections,
    appNodes,
    databasesPerServer,
    connectionLimit,
    perPodDbBudget,
    dataPoolMaxConnections,
    belowMinimum: perPodDbBudget <= BYODB_AUXILIARY_POOL_RESERVE,
  };
};

/**
 * Resolve the per-database data-pool size plus the saturation guard for BYODB
 * pools.
 *
 * The queue guard exists because a saturated pool grows an unbounded set of
 * waiting callers: a long-lived BYODB pool must fail fast instead of turning
 * that queue into upstream request timeouts and coordination-lease occupancy.
 */
export const resolveByodbDataDbPoolSettings = (
  env: Record<string, string | undefined> = process.env
): IByodbDataDbPoolSettings => {
  const explicitMax = parsePositiveInteger(env.BYODB_DATA_DB_POOL_MAX);
  const budget = resolveBudget(env);
  const derived = budget?.dataPoolMaxConnections;

  // The formula may raise the legacy default up to the burst-headroom target; an
  // explicit ceiling still wins when it is lower.
  const max = Math.max(
    1,
    Math.min(
      explicitMax ??
        (derived !== undefined ? TARGET_BYODB_DATA_DB_POOL_MAX : DEFAULT_BYODB_DATA_DB_POOL_MAX),
      derived ?? Number.POSITIVE_INFINITY
    )
  );

  const source: IByodbDataDbPoolSettings['source'] =
    explicitMax !== undefined && (derived === undefined || explicitMax <= derived)
      ? 'explicit'
      : derived !== undefined
        ? 'formula'
        : 'default';

  // Default the queue to one pool's worth of waiters: a burst can queue, a
  // cascade cannot. `0` is meaningful here and means "never queue".
  const queueLimit = parseNonNegativeInteger(env.BYODB_DATA_DB_QUEUE_LIMIT) ?? max;
  const queueTimeoutMillis =
    parseNonNegativeInteger(env.BYODB_DATA_DB_QUEUE_TIMEOUT_MS) ??
    DEFAULT_BYODB_DATA_DB_QUEUE_TIMEOUT_MS;

  return {
    max,
    queueLimit,
    queueTimeoutMillis,
    ...(budget !== undefined ? { budget } : {}),
    ...(explicitMax !== undefined ? { explicitMax } : {}),
    source,
  };
};

/**
 * Resolve the schema-coordination pool for one data-database container.
 *
 * This pool uses the **meta** connection string, so its size is not part of the
 * BYODB customer-database budget. Each cached container owns one pool, which
 * makes the process-wide coordination demand `pods × warm containers ×
 * maxConnections` against the meta server; keep that product inside the meta
 * server's own budget and override `V2_SCHEMA_COORDINATION_MAX_CONNECTIONS` when
 * it is not.
 *
 * The default moves from 8 to 32 for BYODB containers because a held lease pins
 * one connection for the whole coordinated write. The short connect timeout is
 * intentional: a lease that cannot get a connection must fail the request
 * instead of occupying a slot that the next request needs.
 */
export const resolveByodbSchemaCoordinationSettings = (
  env: Record<string, string | undefined> = process.env
): IByodbSchemaCoordinationSettings => {
  const explicitMax = parsePositiveInteger(env.V2_SCHEMA_COORDINATION_MAX_CONNECTIONS);
  const explicitTimeout = parseNonNegativeInteger(env.V2_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS);
  return {
    maxConnections: explicitMax ?? TARGET_BYODB_SCHEMA_COORDINATION_MAX_CONNECTIONS,
    connectionTimeoutMillis:
      explicitTimeout ?? DEFAULT_BYODB_SCHEMA_COORDINATION_CONNECTION_TIMEOUT_MS,
    source: explicitMax !== undefined ? 'explicit' : 'default',
  };
};
